// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

import "./interfaces/IERC20.sol";

// The legacy ADX-STAKING pool (0xB6456b57f03352bE48Bf101B46c1752a0813491a)
interface ILegacyStakingPool {
	function totalSupply() external view returns (uint);
	function limitRemaining() external view returns (uint);
	function limitLastReset() external view returns (uint);
	function maxDailyPenaltiesPromilles() external view returns (uint);
	function penalize(uint adxAmount) external;
}

// Meant to be set as the guardian of the legacy pool. It burns the pool's ADX via penalize() so that the value of each share
// declines linearly: by promillesPerDay of its startTime value every day, until it reaches zero.
// Since it burns from the pool itself, every exit (migrate, rageLeave, leave/withdraw) is affected equally.
// burn() is permissionless: calling it more often only makes the decline smoother, and a missed call is caught up by the next one,
// within the pool's daily penalty limit (maxDailyPenaltiesPromilles of the pool's balance per 24 hours).
// To stop it, governance sets the pool's guardian to something else.
contract StakingPoolLinearBurner {
	ILegacyStakingPool public immutable pool;
	IERC20 public immutable ADX;
	uint public immutable startTime;
	// ADX per share at startTime, 1e18 precision (same as the pool's shareValue())
	uint public immutable startShareValue;
	uint public immutable promillesPerDay;

	constructor(ILegacyStakingPool _pool, IERC20 _adx, uint _startTime, uint _startShareValue, uint _promillesPerDay) {
		require(_promillesPerDay > 0 && _promillesPerDay <= 1000, "BAD_RATE");
		pool = _pool;
		ADX = _adx;
		startTime = _startTime;
		startShareValue = _startShareValue;
		promillesPerDay = _promillesPerDay;
	}

	// The ADX the pool should hold right now, given its current shares
	function targetBalance() public view returns (uint) {
		if (block.timestamp <= startTime) return type(uint).max;
		// elapsed seconds * promilles per day, compared against 1000 promilles * 1 day
		uint burnedPromilleSeconds = (block.timestamp - startTime) * promillesPerDay;
		if (burnedPromilleSeconds >= 1000 days) return 0;
		return (startShareValue * pool.totalSupply() * (1000 days - burnedPromilleSeconds)) / (1000 days * 1e18);
	}

	function burnable() public view returns (uint) {
		uint balance = ADX.balanceOf(address(pool));
		uint target = targetBalance();
		if (balance <= target) return 0;
		uint amount = balance - target;
		// mirror the pool's resetLimits() so that penalize() never fails on LIMITS
		uint limit = block.timestamp - pool.limitLastReset() > 24 hours
			? (balance * pool.maxDailyPenaltiesPromilles()) / 1000
			: pool.limitRemaining();
		return amount < limit ? amount : limit;
	}

	function burn() external {
		uint amount = burnable();
		require(amount > 0, "NOTHING_TO_BURN");
		pool.penalize(amount);
	}
}
