// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;

import "./libs/SafeERC20.sol";

contract ADXFlashLoans {
	// Very important that this contract does not have any storage
	function flash(GeneralERC20 token, uint amount, address to, bytes memory data) public {
		uint bal = token.balanceOf(address(this));
		token.transfer(to, amount);
		assembly {
			let result := delegatecall(gas(), to, add(data, 0x20), mload(data), 0, 0)
			switch result case 0 {
				let size := returndatasize()
				let ptr := mload(0x40)
				returndatacopy(ptr, 0, size)
				revert(ptr, size)
			}
			default {}
		}
		require(token.balanceOf(address(this)) == bal, 'FLASHLOAN_NOT_RETURNED');
	}
}


