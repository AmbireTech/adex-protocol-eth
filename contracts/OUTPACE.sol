// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "./libs/SafeERC20.sol";
import "./libs/MerkleProof.sol";
import "./libs/SignatureValidator.sol";

contract OUTPACE {
	// This is the bare minimum: the guardian can enforce longer times
	uint public constant CHALLENGE_TIME = 3 days;

	// The guardian has two roles: it's the beneficiery of the remaining channel funds if it's closed, and it can trigger a challenge
	struct Channel {
		address leader;
		address follower;
		address guardian;
		address tokenAddr;
		bytes32 nonce;
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
	// has two santinel values: 0 means no challenge, uint.max means failed challenge (channel is closed)
	mapping (bytes32 => uint) public challenges;
	uint private constant CLOSED = type(uint256).max;
	
	// remaining per channel (channelId => uint)
	mapping (bytes32 => uint) public remaining;
	// withdrawn per channel user (channelId => (account => uint))
	mapping (bytes32 => mapping (address => uint)) public withdrawnPerUser;
	// deposits per channel (channelId => (depositor => uint))
	mapping (bytes32 => mapping (address => uint)) public deposits;
	// last used stateRoot per channel
	mapping (bytes32 => bytes32) public lastStateRoot;

	// events
	// @TODO should we emit the full channel? see gas costs
	event LogChannelDeposit(bytes32 indexed channelId, uint amount);
	event LogChannelWithdraw(bytes32 indexed channelId, uint amount);
	event LogChannelChallenge(bytes32 indexed channelId, uint expires);
	event LogChannelResume(bytes32 indexed channelId);
	event LogChannelClose(bytes32 indexed channelId);

	// Functions
	function deposit(Channel calldata channel, uint amount) external {
		bytes32 channelId = keccak256(abi.encode(channel));
		require(amount > 0, 'zero deposit');
		require(challenges[channelId] == 0, 'channel is closed or challenged');
		remaining[channelId] += amount;
		deposits[channelId][msg.sender] += amount;

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
		uint challengeExpirationTime = challenges[channelId];
		require(challengeExpirationTime != CLOSED, 'channel is closed');
		// We only need to update this for challenged channels since it's needed on liquidation
		if (challengeExpirationTime != 0) lastStateRoot[channelId] = withdrawal.stateRoot;

		// Check the signatures
		bytes32 hashToSign = keccak256(abi.encode(address(this), channelId, withdrawal.stateRoot));
		require(SignatureValidator.isValid(hashToSign, withdrawal.channel.leader, withdrawal.sigLeader), 'leader sig');
		require(SignatureValidator.isValid(hashToSign, withdrawal.channel.follower, withdrawal.sigFollower), 'follower sig');

		// Check the merkle proof
		bytes32 balanceLeaf = keccak256(abi.encode(earner, withdrawal.balanceTreeAmount));
		require(MerkleProof.isContained(balanceLeaf, withdrawal.proof, withdrawal.stateRoot), 'balance leaf not found');

		uint toWithdraw = withdrawal.balanceTreeAmount - withdrawnPerUser[channelId][earner];

		// Update storage
		withdrawnPerUser[channelId][earner] = withdrawal.balanceTreeAmount;
		remaining[channelId] -= toWithdraw;

		// Emit the event
		emit LogChannelWithdraw(channelId, toWithdraw);

		return toWithdraw;
	}

	function challenge(Channel calldata channel) external {
		// Leaving this one out for two reasons 1) save the sload 2) allow challenging in cases like being unavailable to start new campaigns
		// same applies for resuming
		//require(remaining[channelId] > 0, 'no funds to be distributed');
		require(msg.sender == channel.leader || msg.sender == channel.follower || msg.sender == channel.guardian, 'only validators and guardian can challenge');
		bytes32 channelId = keccak256(abi.encode(channel));
		require(challenges[channelId] == 0, 'channel is closed or challenged');
		uint expires = block.timestamp + CHALLENGE_TIME;
		challenges[channelId] = expires;

		emit LogChannelChallenge(channelId, expires);
	}

	function resume(Channel calldata channel, bytes32[3] calldata sigLeader, bytes32[3] calldata sigFollower) external {
		bytes32 channelId = keccak256(abi.encode(channel));
		uint challengeExpires = challenges[channelId];
		require(challengeExpires != 0 && challengeExpires != CLOSED, 'channel is not challenged');
		// NOTE: we can resume the channel by mutual consent even if it's closable, so we won't check whether challengeExpires is in the future
		bytes32 hashToSign = keccak256(abi.encodePacked('resume', channelId, challengeExpires));
		require(SignatureValidator.isValid(hashToSign, channel.leader, sigLeader), 'leader sig');
		require(SignatureValidator.isValid(hashToSign, channel.follower, sigFollower), 'follower sig');

		challenges[channelId] = 0;

		emit LogChannelResume(channelId);
	}

	function close(Channel calldata channel) external {
		address guardian = channel.guardian;
		require(msg.sender == guardian, 'must be called by guardian');
		bytes32 channelId = keccak256(abi.encode(channel));
		uint challengeExpires = challenges[channelId];
		require(challengeExpires != 0 && challengeExpires != CLOSED, 'channel is active or closed');
		require(block.timestamp > challengeExpires, 'channel is not closable yet');

		uint toRefund = remaining[channelId];
		remaining[channelId] = 0;
		challenges[channelId] = CLOSED;

		SafeERC20.transfer(channel.tokenAddr, guardian, toRefund);

		emit LogChannelClose(channelId);
	}
}
