// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "../interfaces/IADXToken.sol";
import "../StakingPool.sol";

interface ILegacyStaking {
	struct BondState {
		bool active;
		// Data type must be larger than MAX_SLASH (2**64 > 10**18)
		uint64 slashedAtStart;
		uint64 willUnlock;
	}
	function bonds(bytes32 id) external view returns (BondState calldata);
	function slashPoints(bytes32 id) external view returns (uint);
}

contract StakingMigrator {
	ILegacyStaking public constant legacyStaking = ILegacyStaking(0x4846C6837ec670Bbd1f5b485471c8f64ECB9c534);
	IADXToken public constant ADXToken = IADXToken(0xADE00C28244d5CE17D72E40330B1c318cD12B7c3);
	bytes32 public constant poolId = 0x2ce0c96383fb229d9776f33846e983a956a7d95844fac57b180ed0071d93bb28;
	StakingPool public newStaking;
	
	uint public constant BONUS_PROMILLES = 97;

	mapping(bytes32 => bool) migratedBonds;

	constructor(StakingPool _newStaking) {
		newStaking = _newStaking;
		ADXToken.approve(address(_newStaking), type(uint256).max);
	}

	function migrate(uint bondAmount, uint nonce, address recipient, uint extraAmount) external {
		require(legacyStaking.slashPoints(poolId) == 1e18, 'POOL_NOT_SLASHED');

		bytes32 id = keccak256(abi.encode(address(legacyStaking), msg.sender, bondAmount, poolId, nonce));

		require(!migratedBonds[id], 'BOND_MIGRATED');
		migratedBonds[id] = true;

		ILegacyStaking.BondState memory bondState = legacyStaking.bonds(id);
		require(bondState.active, 'BOND_NOT_ACTIVE');

		if (bondState.willUnlock > 0) {
			ADXToken.supplyController().mint(address(ADXToken), recipient, bondAmount);
		} else {
			uint bonus = bondAmount * BONUS_PROMILLES / 1000;
			uint toMint = bondAmount + bonus;
			ADXToken.supplyController().mint(address(ADXToken), address(this), toMint);

			// if there is an extraAmount, we expect that the staker will send it to this contract before calling this,
			// in the same txn (by using Identity)
			newStaking.enterTo(recipient, toMint + extraAmount);
		}
	}
}
