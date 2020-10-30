// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../libs/SafeMath.sol";
import "../libs/SafeERC20.sol";
import "../libs/MerkleProof.sol";
import "../libs/v2/ChannelLibraryV2.sol";
import "../libs/MerkleTree.sol";

contract Outpace {
	using SafeMath for uint;
	using ChannelLibraryV2 for ChannelLibraryV2.Channel;
    using MerkleTree for uint[];

    struct BulkWithdraw {
        ChannelLibraryV2.Channel[] channels;
        bytes32[] stateRoots;
        bytes32[3][][] signatures;
        bytes32[][] proofs;
        uint256[] amountInTrees;
        uint256[] amountWithdrawnPerChannel;
    }

 	// channelId => channelState
	mapping (bytes32 => ChannelLibraryV2.State) public states;
	
	// withdrawn per channel (channelId => uint)
	mapping (bytes32 => uint) public remaining;
	mapping (address => bytes32) public withdrawnPerUser;

	// Events
	event LogChannelOpen(bytes32 indexed channelId);
	event LogChannelWithdrawExpired(bytes32 indexed channelId, uint amount);
	event LogChannelWithdraw(bytes32 indexed balanceRoot, uint amount);

	// All functions are external
	function channelOpen(ChannelLibraryV2.Channel calldata channel)
		external
	{
		bytes32 channelId = ChannelLibraryV2.hash(channel);
		require(states[channelId] == ChannelLibraryV2.State.Unknown, "INVALID_STATE");
		require(msg.sender == channel.creator, "INVALID_CREATOR");
		require(ChannelLibraryV2.isValid(channel, now), "INVALID_CHANNEL");
		
		states[channelId] = ChannelLibraryV2.State.Active;
        remaining[channelId] = channel.tokenAmount;

		SafeERC20.transferFrom(channel.tokenAddr, msg.sender, address(this), channel.tokenAmount);

		emit LogChannelOpen(channelId);
	}

	function channelWithdrawExpired(ChannelLibraryV2.Channel calldata channel)
		external
	{
		bytes32 channelId = ChannelLibraryV2.hash(channel);
		require(states[channelId] == ChannelLibraryV2.State.Active, "INVALID_STATE");
		require(now > channel.validUntil, "NOT_EXPIRED");
		require(msg.sender == channel.creator, "INVALID_CREATOR");
		
		uint toWithdraw = remaining[channelId];

		// NOTE: we will not update withdrawn, since a WithdrawExpired does not count towards normal withdrawals
		states[channelId] = ChannelLibraryV2.State.Expired;
		
		SafeERC20.transfer(channel.tokenAddr, msg.sender, toWithdraw);

		emit LogChannelWithdrawExpired(channelId, toWithdraw);
	}

    function channelWithdrawBulk(BulkWithdraw calldata bulkWithdraw)
        external
    {

        // validate withdrawn hash
        if(bulkWithdraw.amountWithdrawnPerChannel.length > 0 ) {
            require(bulkWithdraw.amountWithdrawnPerChannel.computeRoot(msg.sender) == withdrawnPerUser[msg.sender], 'INVALID_WITHDRAW_DATA');
        } else {
            require(withdrawnPerUser[msg.sender] == bytes32(0), 'INVALID_WTHDRAWAL_DATA');
        }

        uint256 currentTotalAmountToWithdraw = 0;
        
        for(uint i = 0; i < bulkWithdraw.channels.length; i++) {
            ChannelLibraryV2.Channel calldata channel = bulkWithdraw.channels[i];
            bytes32 stateRoot = bulkWithdraw.stateRoots[i];
            uint amountInTree = bulkWithdraw.amountInTrees[i];
            bytes32[3][] calldata signature = bulkWithdraw.signatures[i];

            bytes32 channelId = ChannelLibraryV2.hash(channel);
            require(states[channelId] == ChannelLibraryV2.State.Active, "INVALID_STATE");
            require(now <= channel.validUntil, "EXPIRED");
        
            bytes32 hashToSign = keccak256(abi.encode(channelId, stateRoot));
            require(ChannelLibraryV2.isSignedBySupermajority(channel, hashToSign, signature), "NOT_SIGNED_BY_VALIDATORS");
        
            bytes32 balanceLeaf = keccak256(abi.encode(msg.sender, amountInTree));
            require(MerkleProof.isContained(balanceLeaf, bulkWithdraw.proofs[i], stateRoot), "BALANCELEAF_NOT_FOUND");
		    
            uint256 amountToWithdraw;
            if (bulkWithdraw.amountWithdrawnPerChannel.length > 0 && (bulkWithdraw.amountWithdrawnPerChannel.length - 1) > i) {
                amountToWithdraw = amountInTree.sub(bulkWithdraw.amountWithdrawnPerChannel[i]);
            } else {
                amountToWithdraw = 0;
            }
            remaining[channelId] = remaining[channelId].sub(amountToWithdraw);
            currentTotalAmountToWithdraw = currentTotalAmountToWithdraw.add(amountToWithdraw);
        }
        
        // write to storage
        bytes32 updateBalancesRootHash = bulkWithdraw.amountInTrees.computeRoot(msg.sender);
        withdrawnPerUser[msg.sender] = updateBalancesRootHash;

		SafeERC20.transfer(bulkWithdraw.channels[0].tokenAddr, msg.sender, currentTotalAmountToWithdraw);
		emit LogChannelWithdraw(updateBalancesRootHash, currentTotalAmountToWithdraw);
    }

}
