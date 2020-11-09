// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;
import "./ChannelLibraryV2.sol";

library WithdrawnPerChannelLibrary {
    using ChannelLibraryV2 for ChannelLibraryV2.Channel;

    struct WithdrawnPerChannel {
        bytes32 channelId;
        uint256 amountWithdrawnPerChannel;
    }

    function find(
        WithdrawnPerChannel[] memory withdrawals,
        ChannelLibraryV2.Channel calldata channel
    ) 
        internal
        view
        returns(int, uint)
    {
        bytes32 channelId = ChannelLibraryV2.hash(channel);
        for(uint i = 0; i < withdrawals.length; i++) {
            if(withdrawals[i].channelId == channelId) {
                return (int(i), withdrawals[i].amountWithdrawnPerChannel);
            }
        }
        return (-1, uint(0));
    }


    function computeMerkleRoot(WithdrawnPerChannel[] memory withdrawals, address sender, uint256 nCurr)
        internal
        pure
        returns (bytes32)
    {
        // uint256 nCurr = withdrawals.length;

        if (nCurr == 0) {
            return bytes32(0);
        }

        if (nCurr == 1) {
            return hashNode(sender, withdrawals[0].amountWithdrawnPerChannel);
        }

        bytes32[] memory tree = new bytes32[](nCurr);

        while (1 < nCurr) {
            // We pair and hash sibling elements in the current layer starting from
            // the left to the right, and store the hashes in the next layer.
            // If nCurr is odd, then the right-most element in current layer will
            // remain unpaired - we do not account for it in `nNext` right now, as
            // `nCurr / 2` rounds down, but we will account for it later.
            uint256 nNext = nCurr / 2;

            // Loop over all paired sibling elements
            for (uint256 iNext = 0; iNext < nNext; iNext++) {
                uint256 iCurr = iNext * 2;
                tree[iNext] = hashLeafPair(
                    hashNode(sender, withdrawals[iCurr].amountWithdrawnPerChannel),
                    hashNode(sender, withdrawals[iCurr + 1].amountWithdrawnPerChannel)
                );
            }
            
            if (nCurr % 2 == 1) {
                tree[++nNext - 1] = tree[nCurr - 1];
            }

            nCurr = nNext;
        }
        
        return tree[0];
    }

    function hashNode(address sender, uint256 balance) 
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(sender, balance));
    }

    function hashLeafPair(bytes32 left, bytes32 right)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(left, right));
    }
}
