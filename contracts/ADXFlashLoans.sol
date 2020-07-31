// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;
pragma experimental ABIEncoderV2;

import "./libs/SafeERC20.sol";
import "./Identity.sol";

contract ADXFlashLoans {
	function flash(GeneralERC20 token, uint amount, Identity receiver, Identity.Transaction[] memory txns, bytes32[3][] memory signatures) public {
		uint bal = token.balanceOf(address(this));
		token.transfer(address(receiver), amount);
		receiver.execute(txns, signatures);
		require(token.balanceOf(address(this)) == bal, 'FLASHLOAN_NOT_RETURNED');
	}
}


