// SPDX-License-Identifier: agpl-3.0

import "./interfaces/IStakingPool.sol";
import "./interfaces/IERC20.sol";

contract StakingMigratorGovernance {
	address public immutable actualGovernance;

	constructor() {
		actualGovernance = msg.sender;
	}

	function migrate(IStakingPool oldPool, uint shares, bool skipMint, IStakingPool newPool) external {
		// first, pull the old staking tokens and temporarily set rage leave percentage so that we can pull the baseToken
		IERC20(address(oldPool)).transferFrom(msg.sender, address(this), shares); 
		uint rageReceived = oldPool.rageReceivedPromilles();
		oldPool.setRageReceived(1000);
		oldPool.rageLeave(shares, skipMint);
		oldPool.setRageReceived(rageReceived);

		// then stake all baseTokens we have in the new pool
		// if we happen to get extra tokens, user gets them
		IERC20 token = IERC20(oldPool.baseToken());
		require(token == IERC20(newPool.baseToken()), "baseToken not the same");
		uint tokenAmount = token.balanceOf(address(this));
		token.approve(address(newPool), tokenAmount);
		newPool.enterTo(msg.sender, tokenAmount);
	}

	// needed because we appoint this contract as the sole governance of the StakingPool, so we need to be able 
	function call(IStakingPool pool, bytes calldata data) external {
		require(msg.sender == actualGovernance, "is not governance");
		(bool success, bytes memory returnData) = address(pool).call{ value: 0 }(data);
		uint size = returnData.length;
		if (success) {
			assembly {
				return (add(returnData, 32), size)
			}
		} else {
			assembly {
				revert(add(returnData, 32), size)
			}
		}
	}
}