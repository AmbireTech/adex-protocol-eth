// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

contract MockUniswap {
    
    function WETH() external pure returns(address) {
        return address(1);
    }

    function swapTokensForExactTokens(
        uint amountOut,
		uint /*amountInMax*/,
		address[] calldata /*path*/,
		address /*to*/,
		uint /*deadline*/
    ) external pure returns (uint[] memory amounts) {
        amounts = new uint[](3);
        amounts[0] = amountOut / 1000;
        amounts[1] = amountOut / 1000;
        amounts[2] = amountOut / 1000;
    }
}
