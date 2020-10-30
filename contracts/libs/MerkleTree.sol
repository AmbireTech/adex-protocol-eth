// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;

library MerkleTree {
    function computeRoot(uint[] memory balances, address sender)
        internal
        pure
        returns (bytes32)
    {
        uint256 len = balances.length;
        if(len % 2 == 1) {
            // duplicate the last item to make it even
            balances[len] = balances[len - 1];
        }

        uint256 nCurr = balances.length;
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
                    hashNode(sender, balances[iCurr]),
                    hashNode(sender, balances[iCurr + 1])
                );
            }

            // // If the right-most element remained unpaired, promote it to the
            // // end of the next layer, and increment nNext to account for it.
            // if (nCurr % 2 == 1) {
            //     tree[++nNext - 1] = tree[nCurr - 1];
            // }

            nCurr = nNext;
        }
        
        return tree[0];
    }

    function hashNode(address sender, uint256 balance) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(sender, balance));
    }

    function hashLeafPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(left, right));
    }
}