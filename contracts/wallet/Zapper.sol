// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.1;

interface IAaveLendingPool {
  function deposit(
    address asset,
    uint256 amount,
    address onBehalfOf,
    uint16 referralCode
  ) external;
}

contract WalletZapper {
	function exchange() external {
	}

	function wrapLending() external {
	}
}
