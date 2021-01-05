// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";
import "./libs/MerkleProof.sol";
import "./libs/ChannelLibrary.sol";

// AUDIT: Things we should look for
// 1) every time we check the state, the function should either revert or change the state
// 2) state transition: channelOpen locks up tokens, then all of the tokens can be withdrawn on channelExpiredWithdraw, except how many were withdrawn using channelWithdraw
// 3) external calls (everything using SafeERC20) should be at the end
// 4) channel can always be 100% drained with Withdraw/ExpiredWithdraw

contract AdExCore {
	using SafeMath for uint;
	using ChannelLibrary for ChannelLibrary.Channel;

 	// channelId => channelState
	mapping (bytes32 => ChannelLibrary.State) public states;
	
	// withdrawn per channel (channelId => uint)
	mapping (bytes32 => uint) public withdrawn;
	// withdrawn per channel user (channelId => (account => uint))
	mapping (bytes32 => mapping (address => uint)) public withdrawnPerUser;

	// Events
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
}
