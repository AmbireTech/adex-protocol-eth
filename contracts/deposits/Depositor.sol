// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "../OUTPACE.sol";
import "../libs/SafeERC20.sol";

contract Depositor {
	constructor(address token, address depositor) {
		uint amount = GeneralERC20(token).balanceOf(address(this));
		SafeERC20.transfer(token, 0x942f9CE5D9a33a82F88D233AEb3292E680230348, amount);
		assembly {
			selfdestruct(0)
		}
	}
}

