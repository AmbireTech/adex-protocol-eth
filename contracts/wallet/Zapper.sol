// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.1;

import "../interfaces/IERC20.sol";

interface IAaveLendingPool {
  function deposit(
    address asset,
    uint256 amount,
    address onBehalfOf,
    uint16 referralCode
  ) external;
  function withdraw(
    address asset,
    uint256 amount,
    address to
  ) external returns (uint256);
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

// Decisions: will start with aave over compound (easier API - has `onBehalfOf`, referrals), compound can be added later if needed
// uni v3 needs to be supported since it's proving that it's efficient and the router is different
contract WalletZapper {
	// @TODO: is it only one lending pool?
	IAaveLendingPool public lendingPool;
	uint16 refCode;
	constructor(IAaveLendingPool _lendingPool, uint16 _refCode) {
		lendingPool = _lendingPool;
		refCode = _refCode;
		// @TODO approvals
	}

	struct Trade {
		IUniswapSimple router;
		// @TODO should there be a trade type
		uint amountIn;
		uint amountOutMin;
		address[] path;
		bool wrap;
	}

	// @TODO an additional approve router function (onlyOwner)
	function approve(address token, address spender) public {
		// require onlyOwner
		IERC20(token).approve(spender, type(uint256).max);
	}

	// @TODO: return all the outputs from this?
	function exchange(address[] calldata assetsToUnwrap, Trade[] memory trades) external {
		for (uint i=0; i!=assetsToUnwrap.length; i++) {
			lendingPool.withdraw(assetsToUnwrap[i], type(uint256).max, address(this));
		}
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
				uint[] memory amounts = trade.router.swapExactTokensForTokens(trade.amountIn, trade.amountOutMin, trade.path, address(this), deadline);
				uint lastIdx = trade.path.length - 1;
				lendingPool.deposit(trade.path[lastIdx], amounts[lastIdx], to, refCode);
			}
		}
		// @TODO are there ways to ensure there are no leftover funds?

	}

	function wrapLending(address[] calldata assetsToWrap) external {
		for (uint i=0; i!=assetsToWrap.length; i++) {
			lendingPool.deposit(assetsToWrap[i], IERC20(assetsToWrap[i]).balanceOf(address(this)), msg.sender, refCode);
		}
	}
	function unwrapLending(address[] calldata assetsToUnwrap) external {
		for (uint i=0; i!=assetsToUnwrap.length; i++) {
			lendingPool.withdraw(assetsToUnwrap[i], type(uint256).max, msg.sender);
		}
	}
}
