// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "../libs/SafeMath.sol";
import "../libs/SafeERC20.sol";
import "../libs/MerkleProof.sol";
import "../libs/v2/ChannelLibraryV2.sol";
import "../libs/v2/WithdrawnPerChannelLibrary.sol";

contract Outpace {
	using SafeMath for uint;
	using ChannelLibraryV2 for ChannelLibraryV2.Channel;
    using WithdrawnPerChannelLibrary for WithdrawnPerChannelLibrary.WithdrawnPerChannel[];

    struct BulkWithdraw {
        ChannelLibraryV2.Channel[] channels;
        bytes32[] stateRoots;
        bytes32[3][][] signatures;
        bytes32[][] proofs;
        uint256[] amountInTrees;
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
		
		uint toWithdraw = remaining[channelId];

		// NOTE: we will not update withdrawn, since a WithdrawExpired does not count towards normal withdrawals
		states[channelId] = ChannelLibraryV2.State.Expired;

        delete remaining[channelId];
		
		SafeERC20.transfer(channel.tokenAddr, channel.creator, toWithdraw);

		emit LogChannelWithdrawExpired(channelId, toWithdraw);
	}

    function channelWithdrawBulk(
        BulkWithdraw calldata bulkWithdraw, 
        WithdrawnPerChannelLibrary.WithdrawnPerChannel[] memory userAmountWithdrawnPerChannel
    )
        external
    {
        // validate withdrawn hash
        require(
            userAmountWithdrawnPerChannel
                .computeMerkleRoot(msg.sender, userAmountWithdrawnPerChannel.length) ==  withdrawnPerUser[msg.sender], 
            'INVALID_WITHDRAW_DATA'
        );

        // allocates memory
        WithdrawnPerChannelLibrary.WithdrawnPerChannel[] memory updateAmountWithdrawnPerChannel = new WithdrawnPerChannelLibrary.WithdrawnPerChannel[](
            bulkWithdraw.channels.length + userAmountWithdrawnPerChannel.length
        );

        // copy userAmountWithdrawnPerChannel
        for(uint k = 0; k < userAmountWithdrawnPerChannel.length; k++) {
            updateAmountWithdrawnPerChannel[k] = userAmountWithdrawnPerChannel[k];
        }
        
        uint newWithdrawLeafIndex = 0;
        uint currentTotalAmountToWithdraw = 0;
        uint withdrawnLen = userAmountWithdrawnPerChannel.length;

        for(uint i = 0; i < bulkWithdraw.channels.length; i++) {
            ChannelLibraryV2.Channel calldata channel  = bulkWithdraw.channels[i];
            uint amountInTree = bulkWithdraw.amountInTrees[i];
            
            validateChannelWithSignatureAndBalance(
                channel,
                bulkWithdraw.stateRoots[i],
                amountInTree,
                bulkWithdraw.signatures[i],
                bulkWithdraw.proofs[i]
            );

            bytes32 channelId = ChannelLibraryV2.hash(channel);
            (int index, uint amountWithdrawn) = updateAmountWithdrawnPerChannel.find(channel);

            uint256 amountToWithdraw = amountInTree.sub(amountWithdrawn);
            
            // item not found
            if (index == -1) {
                WithdrawnPerChannelLibrary.WithdrawnPerChannel memory newItem = WithdrawnPerChannelLibrary.WithdrawnPerChannel(channelId, amountInTree);
                updateAmountWithdrawnPerChannel[withdrawnLen + newWithdrawLeafIndex] = newItem;
                newWithdrawLeafIndex += 1;
            } else {
                updateAmountWithdrawnPerChannel[uint(index)].amountWithdrawnPerChannel = amountInTree;
            }
            
            require(amountToWithdraw <= remaining[channelId], 'WITHDRAWING_MORE_THAN_CHANNEL');
            remaining[channelId] = remaining[channelId].sub(amountToWithdraw);

            currentTotalAmountToWithdraw = currentTotalAmountToWithdraw.add(amountToWithdraw);
        }

        // filter expired items
        WithdrawnPerChannelLibrary.WithdrawnPerChannel[] memory nonExpiredWithdrawnPerChannel = new WithdrawnPerChannelLibrary.WithdrawnPerChannel[](
            updateAmountWithdrawnPerChannel.length
        );

        // this is required because we could allocate more memory than we use
        // and solidity automatically assigns zero values to empty slots
        uint nonExpiredLength = 0;
        for(uint i = 0; i < updateAmountWithdrawnPerChannel.length; i++) {
            if(states[updateAmountWithdrawnPerChannel[i].channelId] == ChannelLibraryV2.State.Active) {
                nonExpiredWithdrawnPerChannel[nonExpiredLength] = updateAmountWithdrawnPerChannel[i];
                nonExpiredLength += 1;
            }
        }

        bytes32 updateBalancesRootHash = nonExpiredWithdrawnPerChannel.computeMerkleRoot(msg.sender, nonExpiredLength);
        withdrawnPerUser[msg.sender] = updateBalancesRootHash;

		SafeERC20.transfer(bulkWithdraw.channels[0].tokenAddr, msg.sender, currentTotalAmountToWithdraw);
		emit LogChannelWithdraw(updateBalancesRootHash, currentTotalAmountToWithdraw);
    }

    function validateChannelWithSignatureAndBalance(
        ChannelLibraryV2.Channel calldata channel,
        bytes32 stateRoot,
        uint amountInTree,
        bytes32[3][] calldata signature,
        bytes32[] calldata proofs
    ) 
        internal
        view
    {
        bytes32 channelId = ChannelLibraryV2.hash(channel);
        require(states[channelId] == ChannelLibraryV2.State.Active, "INVALID_STATE");
    
        bytes32 hashToSign = keccak256(abi.encode(channelId, stateRoot));
        require(ChannelLibraryV2.isSignedBySupermajority(channel, hashToSign, signature), "NOT_SIGNED_BY_VALIDATORS");
    
        bytes32 balanceLeaf = keccak256(abi.encode(msg.sender, amountInTree));
        require(MerkleProof.isContained(balanceLeaf, proofs, stateRoot), "BALANCELEAF_NOT_FOUND");
    }
}
