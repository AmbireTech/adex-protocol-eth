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
	struct Trade {
		IUniswapSimple router;
		// @TODO should there be a trade type
		uint amountIn;
		uint amountOutMin;
		address[] path;
		bool wrap;
	}

	address admin;

	// @TODO: perhaps hardcode the routers too, and do not pass them in on the struct
	// or not, since we might want to perform different trades using different v2 routers
	// but then we will need an array of allowed spenders in constructor
	
	// @TODO: is it only one lending pool?
	mapping (address => bool) allowedSpenders;
	IAaveLendingPool public lendingPool;
	uint16 aaveRefCode;
	constructor(IAaveLendingPool _lendingPool, uint16 _aaveRefCode, address uniV2Router, address uniV3Router) {
		admin = msg.sender;
		lendingPool = _lendingPool;
		aaveRefCode = _aaveRefCode;
		allowedSpenders[address(_lendingPool)] = true;
		allowedSpenders[uniV2Router] = true;
		allowedSpenders[uniV3Router] = true;
		// @TODO approvals
	}

	// @TODO an additional approve router function (onlyOwner)
	function approve(address token, address spender) external {
		require(msg.sender == admin, "NOT_ADMIN");
		require(allowedSpenders[spender], "NOT_ALLOWED");
		IERC20(token).approve(spender, type(uint256).max);
	}

	// @TODO: return all the outputs from this?
	function exchange(address[] calldata assetsToUnwrap, Trade[] memory trades) external {
		for (uint i=0; i!=assetsToUnwrap.length; i++) {
			lendingPool.withdraw(assetsToUnwrap[i], type(uint256).max, address(this));
		}
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
				lendingPool.deposit(trade.path[lastIdx], amounts[lastIdx], to, aaveRefCode);
			}
		}
		// @TODO are there ways to ensure there are no leftover funds?

	}

	function wrapLending(address[] calldata assetsToWrap) external {
		for (uint i=0; i!=assetsToWrap.length; i++) {
			lendingPool.deposit(assetsToWrap[i], IERC20(assetsToWrap[i]).balanceOf(address(this)), msg.sender, aaveRefCode);
		}
	}
	function unwrapLending(address[] calldata assetsToUnwrap) external {
		for (uint i=0; i!=assetsToUnwrap.length; i++) {
			lendingPool.withdraw(assetsToUnwrap[i], type(uint256).max, msg.sender);
		}
	}

	// V3
	function tradeV3(address uniV3Router, address tokenIn, address tokenOut, uint amount, uint minOut) external {
		ISwapRouter().exactInputSingle(
		    ISwapRouter(uniV3Router).ExactInputSingleParams (
			tokenIn,
			tokenOut,
			3000, // @TODO
			msg.sender,
			block.timestamp,
			amount,
			minOut,
			0
		    )
		);
	}
}
