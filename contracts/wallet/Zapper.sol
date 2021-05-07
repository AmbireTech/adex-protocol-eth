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

// Full interface here: https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/interfaces/IUniswapV2Router01.sol
interface IUniswapSimple {
        function WETH() external pure returns (address);
        function swapTokensForExactTokens(
                uint amountOut,
                uint amountInMax,
                address[] calldata path,
                address to,
                uint deadline
        ) external returns (uint[] memory amounts);
	function swapExactTokensForTokens(
		uint amountIn,
		uint amountOutMin,
		address[] calldata path,
		address to,
		uint deadline
	) external returns (uint[] memory amounts);
}


contract WalletZapper {
	// @TODO: constructor


	struct Trade {
		IUniswapSimple router;
		// @TODO should there be a trade type
		uint amountIn;
		uint amountOutMin;
		address[] path;
		bool wrap;
	}

	function exchange(address[] calldata assetsToUnwrap, Trade[] memory trades) external {
		// @TODO: unwrap
		// @TODO: should those be vars
		address to = msg.sender;
		uint deadline = block.timestamp;
		// @TODO: should trades.length be assigned to a local var? if so, should this be applied to other places in v5 as well?
		for (uint i=0; i!=trades.length; i++) {
			Trade memory trade = trades[i];
			if (!trade.wrap) {
				trade.router.swapExactTokensForTokens(trade.amountIn, trade.amountOutMin, trade.path, to, deadline);
			} else {
				trade.router.swapExactTokensForTokens(trade.amountIn, trade.amountOutMin, trade.path, address(this), deadline);
				// @TODO aaveLendingPool.deposit(trade.path[last], outAmount, to, refCode);
			}
		}
		// @TODO: wrapping

	}

	function wrapLending() external {
	}
}
