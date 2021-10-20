// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

import "../OUTPACE.sol";
import "./Depositor.sol";

contract Sweeper {
	function sweep(OUTPACE outpace, OUTPACE.Channel memory channel, address[] memory depositors) external {
		for (uint i = 0; i < depositors.length; i++) {
			new Depositor{ salt: bytes32(0) }(outpace, channel, depositors[i]);
		}
	}
}

