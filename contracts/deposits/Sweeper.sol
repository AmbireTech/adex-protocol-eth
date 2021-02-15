// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "../OUTPACE.sol";
import "./Depositor.sol";

contract Sweeper {
	function sweep(address token, address[] calldata depositors) external {
		for (uint i = 0; i < depositors.length; i++) {
			new Depositor{ salt: bytes32(0) }(token, depositors[i]);
		}
	}
}

