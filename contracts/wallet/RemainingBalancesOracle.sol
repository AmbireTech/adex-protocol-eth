// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

import "../IdentityFactory.sol";
import "../interfaces/IERC20.sol";

contract RemainingBalancesOracle {
	function getRemainingBalances(
		IdentityFactory factory,
		bytes calldata code, uint256 salt,
		Identity.Transaction[] calldata txns, bytes calldata signature,
		address identity,
		address[] calldata tokenAddrs
	) external returns (uint[] memory) {
		factory.deployAndExecute(code, salt, txns, signature);
		uint len = tokenAddrs.length;
		uint[] memory results = new uint[](len);
		for (uint256 i = 0; i < len; i++) {
			if (tokenAddrs[i] == address(0)) results[i] = address(identity).balance;
			else results[i] = IERC20(tokenAddrs[i]).balanceOf(identity);
		}
		return results;
	}
}
