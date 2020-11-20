
// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

interface IEarningOracle {
    function getTotalEarning(address) external view returns (uint);
}
