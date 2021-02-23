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
}

contract StakingMigrator {
	ILegacyStaking public constant staking = ILegacyStaking(0x4846C6837ec670Bbd1f5b485471c8f64ECB9c534);
	IADXToken public constant ADXToken = IADXToken(0xADE00C28244d5CE17D72E40330B1c318cD12B7c3);
	bytes32 public constant poolId = 0x2ce0c96383fb229d9776f33846e983a956a7d95844fac57b180ed0071d93bb28;
	StakingPool public newStaking;
	
	uint public constant BONUS_PROMILLES = 97;

	mapping(bytes32 => uint) migratedBonds;

	constructor(StakingPool _newStaking) {
		newStaking = _newStaking;
		ADXToken.approve(address(_newStaking), type(uint256).max);
	}

	function requestMigrate(uint amount, uint nonce) external {
		bytes32 id = keccak256(abi.encode(address(staking), msg.sender, amount, poolId, nonce));
		require(migratedBonds[id] == 0, 'BOND_MIGRATED');
		require(staking.bonds(id).active, 'BOND_NOT_ACTIVE');

		migratedBonds[id] = 1;
	}

	function finishMigration(uint amount, uint nonce, address recipient) external {
		bytes32 id = keccak256(abi.encode(address(staking), msg.sender, amount, poolId, nonce));
		require(migratedBonds[id] == 1, 'BOND_NOT_STAGED');
		require(staking.bonds(id).active, 'BOND_STILL_ACTIVE');

		migratedBonds[id] = 2;

		uint bonus = amount * BONUS_PROMILLES / 1000;
		ADXToken.supplyController().mint(address(ADXToken), address(this), bonus);
		ADXToken.transferFrom(msg.sender, address(this), amount);

		newStaking.enterTo(recipient, amount + bonus);
	}
}
