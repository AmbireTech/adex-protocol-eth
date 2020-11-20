// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./interfaces/IAdExCore.sol";
import "./interfaces/IEarningOracle.sol";
import "./libs/ChannelLibrary.sol";


contract EarningOracle is IEarningOracle {
    IAdExCore public core;

    mapping (address => uint) internal totalEarnings;
    mapping (address => mapping(bytes32 => bool)) public tallied;

    constructor (IAdExCore _core) public {
        core = _core;
    }

    function bulkUpdate(bytes32[] calldata channelIds, address[] calldata earners) external {
        for(uint i = 0; i < channelIds.length; i++) {
            bytes32 channelId = channelIds[i];
            address earner = earners[i];
            
            require(tallied[earner][channelId] == false, 'ALREADY_TALLIED');
            require(core.states(channelId) == ChannelLibrary.State.Expired, 'CHANNEL_NOT_EXPIRED');

            tallied[earner][channelId] = true;
            totalEarnings[earner] += core.withdrawnPerUser(channelId, earner);
        }
    }

   function getTotalEarning(address earner) external view override returns (uint) {
       return totalEarnings[earner];
   }
}
