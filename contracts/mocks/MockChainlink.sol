// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

contract MockChainlink {
    function latestAnswer() external pure returns (uint256) {
        return 1e8;
    }
}
