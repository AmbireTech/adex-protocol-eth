// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

import "../libs/SafeERC20.sol";
import "../Identity.sol";

contract ADXFlashLoans {
	// Note: we need to get funds back via transferFrom, rather than performing a balance check,
	// since some ERC20s have built-in token lockup; the new ADXToken is not one of them,
	// but it's the better way to approach things given that this contract can be used for any token
	// NOTE: we cannot use executeBySender since this contract will be the sender
	function flash(address token, uint amount, Identity receiver, Identity.Transaction[] calldata txns, bytes calldata signatures) external {
		SafeERC20.transfer(token, address(receiver), amount);
		receiver.execute(txns, signatures);
		SafeERC20.transferFrom(token, address(receiver), address(this), amount);
	}
}


