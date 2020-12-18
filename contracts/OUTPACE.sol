// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

contract OUTPACE {
	// @TODO challene expiry date 
	enum ChannelState { Normal, Challenged, Closed }
	struct Channel {
		address leader;
		address follower;
		address tokenAddr;
		bytes23 nonce;
	}
	struct Withdrawal {
		Channel channel;
		uint balanceTreeAmount;
		bytes32[3] sigLeader;
		bytes32[3] sigFollower;
		bytes32[] proof;
	}
	struct BalanceLeaf {
		address earner;
		uint amount;
	}

 	// channelId => channelState
	mapping (bytes32 => ChannelState) public states;
	
	// remaining per channel (channelId => uint)
	mapping (bytes32 => uint) public remaining;
	// withdrawn per channel user (channelId => (account => uint))
	mapping (bytes32 => mapping (address => uint)) public withdrawnPerUser;
	// deposits per channel (channelId => (depositId => uint))
	mapping (bytes32 => mapping (bytes32 => uint)) public deposits;


	function open(Channel calldata channel, bytes32 depositId, uint amount) external {
	}

	function withdraw(address earner, address to, Withdrawal[] calldata withdrawals) external {
	}

	function challenge(Channel calldata channel) external {
	}

	function resume(Channel calldata channel, BalanceLeaf[] calldata tree, bytes32[3] calldata sigLeader, bytes32[3] calldata sigFollower) external {
		// @NOTE: can we have type aliases for bytes32[3]
		// @NOTE: we don't have the sum of all deposits so we'll have to compute it frm withdrawnPerUser + remaining
	}

	function close(Channel calldata channel) external {
	}




	/*
	// Events
	// @TODO
	event LogChannelOpen(bytes32 indexed channelId);
	event LogChannelWithdrawExpired(bytes32 indexed channelId, uint amount);
	event LogChannelWithdraw(bytes32 indexed channelId, uint amount);

	// All functions are public
	function channelOpen(ChannelLibrary.Channel memory channel)
		public
	{
		bytes32 channelId = channel.hash();
		require(states[channelId] == ChannelLibrary.State.Unknown, "INVALID_STATE");
		require(msg.sender == channel.creator, "INVALID_CREATOR");
		require(channel.isValid(now), "INVALID_CHANNEL");
		
		states[channelId] = ChannelLibrary.State.Active;

		SafeERC20.transferFrom(channel.tokenAddr, msg.sender, address(this), channel.tokenAmount);

		emit LogChannelOpen(channelId);
	}

	function channelWithdrawExpired(ChannelLibrary.Channel memory channel)
		public
	{
		bytes32 channelId = channel.hash();
		require(states[channelId] == ChannelLibrary.State.Active, "INVALID_STATE");
		require(now > channel.validUntil, "NOT_EXPIRED");
		require(msg.sender == channel.creator, "INVALID_CREATOR");
		
		uint toWithdraw = channel.tokenAmount.sub(withdrawn[channelId]);

		// NOTE: we will not update withdrawn, since a WithdrawExpired does not count towards normal withdrawals
		states[channelId] = ChannelLibrary.State.Expired;
		
		SafeERC20.transfer(channel.tokenAddr, msg.sender, toWithdraw);

		emit LogChannelWithdrawExpired(channelId, toWithdraw);
	}

	function channelWithdraw(ChannelLibrary.Channel memory channel, bytes32 stateRoot, bytes32[3][] memory signatures, bytes32[] memory proof, uint amountInTree)
		public
	{
		bytes32 channelId = channel.hash();
		require(states[channelId] == ChannelLibrary.State.Active, "INVALID_STATE");
		require(now <= channel.validUntil, "EXPIRED");

		bytes32 hashToSign = keccak256(abi.encode(channelId, stateRoot));
		require(channel.isSignedBySupermajority(hashToSign, signatures), "NOT_SIGNED_BY_VALIDATORS");

		bytes32 balanceLeaf = keccak256(abi.encode(msg.sender, amountInTree));
		require(MerkleProof.isContained(balanceLeaf, proof, stateRoot), "BALANCELEAF_NOT_FOUND");

		// The user can withdraw their constantly increasing balance at any time (essentially prevent users from double spending)
		uint toWithdraw = amountInTree.sub(withdrawnPerUser[channelId][msg.sender]);
		withdrawnPerUser[channelId][msg.sender] = amountInTree;

		// Ensure that it's not possible to withdraw more than the channel deposit (e.g. malicious validators sign such a state)
		withdrawn[channelId] = withdrawn[channelId].add(toWithdraw);
		require(withdrawn[channelId] <= channel.tokenAmount, "WITHDRAWING_MORE_THAN_CHANNEL");

		SafeERC20.transfer(channel.tokenAddr, msg.sender, toWithdraw);

		emit LogChannelWithdraw(channelId, toWithdraw);
	}
	*/
}
