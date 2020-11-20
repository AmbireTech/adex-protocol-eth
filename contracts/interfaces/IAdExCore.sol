// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;
import "../libs/ChannelLibrary.sol";

interface IAdExCore {
    function states(bytes32) view external returns (ChannelLibrary.State);
    function withdrawnPerUser(bytes32, address) view external returns (uint);
}