// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.1;

import "../interfaces/IERC20.sol";
import "../interfaces/IUniV3SwapRouter.sol";

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
	struct DiversificationTrade {
		address tokenOut;
		uint allocPts;
		uint amountOutMin;
		bool wrap;
	}

	address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

	address admin;

	// @TODO: perhaps hardcode the routers too, and do not pass them in on the struct
	// or not, since we might want to perform different trades using different v2 routers
	// but then we will need an array of allowed spenders in constructor
	
	// @TODO: is it only one lending pool?
	mapping (address => bool) allowedSpenders;
	IAaveLendingPool public lendingPool;
	uint16 aaveRefCode;
	constructor(IAaveLendingPool _lendingPool, uint16 _aaveRefCode, address[] allowedSpenders) {
		admin = msg.sender;
		lendingPool = _lendingPool;
		aaveRefCode = _aaveRefCode;
		allowedSpenders[address(_lendingPool)] = true;
		for (uint i=0; i!=allowedSpenders.length; i++) {
			allowedSpenders[allowedSpenders[i]] = true;
		}
	}

	function approveMax(address token, address spender) external {
		require(msg.sender == admin, "NOT_ADMIN");
		require(allowedSpenders[spender], "NOT_ALLOWED");
		IERC20(token).approve(spender, type(uint256).max);
	}

	// @TODO: return all the outputs from this?
	function exchangeV2(address[] calldata assetsToUnwrap, Trade[] memory trades) external {
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

	// go in/out of lending assets
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

	// wrap WETH
	function wrapETH() payable external {
		// TODO: it may be slightly cheaper to call deposit() directly
		payable(WETH).transfer(msg.value);
	}

	// Uniswap V3
	// @TODO: multi-path trade
	// @TODO: perhaps simplify this by just making it a proxy to uniV3Router and passing in the whole struct
	function tradeV3(ISwapRouter uniV3Router, address tokenIn, address tokenOut, uint amount, uint minOut) external returns (uint) {
		return uniV3Router.exactInputSingle(
		    ISwapRouter.ExactInputSingleParams (
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

	// @TODO logs/return output amounts?
	function diversifyV3(ISwapRouter uniV3Router, address inputAsset, DiversificationTrade[] memory trades) external {
		uint inputAmount;
		if (inputAsset != address(0)) {
			inputAmount = uniV3Router.exactInputSingle(
			    ISwapRouter.ExactInputSingleParams (
				inputAsset,
				WETH,
				3000, // @TODO
				address(this),
				block.timestamp,
				IERC20(inputAsset).balanceOf(address(this)),
				0, // @TODO minOut
				0
			    )
			);
		} else {
			inputAmount = IERC20(WETH).balanceOf(address(this));
		}

		uint totalAllocPts;
		for (uint i=0; i!=trades.length; i++) {
			DiversificationTrade memory trade = trades[i];
			totalAllocPts += trade.allocPts;
			if (!trade.wrap) {
				uniV3Router.exactInputSingle(
				    ISwapRouter.ExactInputSingleParams (
					WETH,
					trade.tokenOut,
					3000, // @TODO
					msg.sender,
					block.timestamp,
					inputAmount * trade.allocPts / 1000,
					trade.amountOutMin,
					0
				    )
				);
			} else {
				uint amountToDeposit = uniV3Router.exactInputSingle(
				    ISwapRouter.ExactInputSingleParams (
					WETH,
					trade.tokenOut,
					3000, // @TODO
					address(this),
					block.timestamp,
					inputAmount * trade.allocPts / 1000,
					trade.amountOutMin,
					0
				    )
				);
				lendingPool.deposit(trade.tokenOut, amountToDeposit, msg.sender, aaveRefCode);
			}
		}

		require(totalAllocPts == 1000, "ALLOC_PTS");

	}
}
