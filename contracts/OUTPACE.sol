// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "./libs/SafeERC20.sol";
import "./libs/MerkleProof.sol";
import "./libs/SignatureValidator.sol";

contract OUTPACE {
	// This is the bare minimum: the liquidator can enforce longer times
	uint public constant CHALLENGE_TIME = 3 days;

	struct Channel {
		address leader;
		address follower;
		// @TODO: rename liquidator?
		address liquidator;
		address tokenAddr;
		bytes23 nonce;
	}
	struct Withdrawal {
		Channel channel;
		uint balanceTreeAmount;
		bytes32 stateRoot;
		bytes32[3] sigLeader;
		bytes32[3] sigFollower;
		bytes32[] proof;
	}
	struct BalanceLeaf {
		address earner;
		uint amount;
	}

 	// channelId => challengeExpirationTime
	// has two santinel values: 0 means no challenge, uint(-1) means failed challenge (channel is closed)
	mapping (bytes32 => uint) public challenges;
	uint private constant CLOSED = ~uint256(0);
	
	// remaining per channel (channelId => uint)
	mapping (bytes32 => uint) public remaining;
	// withdrawn per channel user (channelId => (account => uint))
	mapping (bytes32 => mapping (address => uint)) public withdrawnPerUser;
	// deposits per channel (channelId => (depositId => uint))
	mapping (bytes32 => mapping (bytes32 => uint)) public deposits;

	// events
	// @TODO should we emit the full channel?
	event LogChannelDeposit(bytes32 indexed channelId, uint amount);

	// Functions
	// @TODO
	// event design, particularly for withdrawal
	function deposit(Channel calldata channel, bytes32 depositId, uint amount) external {
		bytes32 channelId = keccak256(abi.encode(channel));
		require(amount > 0, 'zero deposit');
		require(deposits[channelId][depositId] == 0, 'deposit already exists');
		require(challenges[channelId] == 0, 'channel is closed or challenged');
		remaining[channelId] = remaining[channelId] + amount;
		deposits[channelId][depositId] = amount;

		SafeERC20.transferFrom(channel.tokenAddr, msg.sender, address(this), amount);
		emit LogChannelDeposit(channelId, amount);
	}

	function withdraw(Withdrawal calldata withdrawal) external {
		SafeERC20.transfer(withdrawal.channel.tokenAddr, msg.sender, calcWithdrawAmount(msg.sender, withdrawal));
	}

	function bulkWithdraw(address earner, address to, Withdrawal[] calldata withdrawals) external {
		require(withdrawals.length > 0, 'no withdrawals');
		uint toWithdraw;
		address tokenAddr = withdrawals[0].channel.tokenAddr;
		for (uint i = 0; i < withdrawals.length; i++) {
			Withdrawal calldata withdrawal = withdrawals[i];
			require(withdrawal.channel.tokenAddr == tokenAddr, 'only one token can be withdrawn');
			toWithdraw += calcWithdrawAmount(earner, withdrawal);
		}
		// @TODO test for this
		// Do not allow to change `to` if the caller is not the earner
		if (earner != msg.sender) to = earner;
		SafeERC20.transfer(tokenAddr, to, toWithdraw);
	}

	function calcWithdrawAmount(address earner, Withdrawal calldata withdrawal) internal returns (uint) {
		bytes32 channelId = keccak256(abi.encode(withdrawal.channel));
		// require that the is not closed
		require(challenges[channelId] != CLOSED, 'channel is closed');

		bytes32 hashToSign = keccak256(abi.encode(channelId, withdrawal.stateRoot));
		require(SignatureValidator.isValidSignature(hashToSign, withdrawal.channel.leader, withdrawal.sigLeader), 'leader sig');
		require(SignatureValidator.isValidSignature(hashToSign, withdrawal.channel.follower, withdrawal.sigFollower), 'follower sig');

		// check the merkle proof
		bytes32 balanceLeaf = keccak256(abi.encode(earner, withdrawal.balanceTreeAmount));
		require(MerkleProof.isContained(balanceLeaf, withdrawal.proof, withdrawal.stateRoot), 'balance leaf not found');

		uint toWithdrawChannel = withdrawal.balanceTreeAmount - withdrawnPerUser[channelId][earner];

		// Update storage
		withdrawnPerUser[channelId][earner] = withdrawal.balanceTreeAmount;
		remaining[channelId] -= toWithdrawChannel;

		return toWithdrawChannel;
	}

	function challenge(Channel calldata channel) external {
		// @TODO: no challenge if no funds remaining?
		require(msg.sender == channel.leader || msg.sender == channel.follower || msg.sender == channel.liquidator, 'only validators and liquidator can challenge');
		bytes32 channelId = keccak256(abi.encode(channel));
		require(challenges[channelId] == 0, 'channel is closed or challenged');
		challenges[channelId] = block.timestamp + CHALLENGE_TIME;
	}

	function resume(Channel calldata channel, bytes32[3][2] calldata sigs) external {
		// @TODO: can resume if no funds remaining?
		bytes32 channelId = keccak256(abi.encode(channel));
		uint challengeExpires = challenges[channelId];
		require(challengeExpires != 0 && challengeExpires != CLOSED, 'channel is not challenged');
		// NOTE: we can resume the channel by mutual consent even if it's closable, so we won't check whether challengeExpires is in the future
		bytes32 hashToSign = keccak256(abi.encodePacked("resume", channelId, challengeExpires));
		require(SignatureValidator.isValidSignature(hashToSign, channel.leader, sigs[0]), 'leader sig');
		require(SignatureValidator.isValidSignature(hashToSign, channel.follower, sigs[1]), 'follower sig');
		challenges[channelId] = 0;
	}

	function close(Channel calldata channel) external {
		address liquidator = channel.liquidator;
		require(msg.sender == liquidator, 'must be called by liquidator');
		bytes32 channelId = keccak256(abi.encode(channel));
		uint challengeExpires = challenges[channelId];
		require(challengeExpires != 0 && challengeExpires != CLOSED, 'channel is active or closed');
		require(block.timestamp > challengeExpires, 'channel is not closable yet');

		uint toRefund = remaining[channelId];
		remaining[channelId] = 0;
		challenges[channelId] = CLOSED;

		SafeERC20.transfer(channel.tokenAddr, liquidator, toRefund);
	}
}
