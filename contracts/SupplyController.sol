// SPDX-License-Identifier: agpl-3.0
//pragma solidity 0.8.7;

import "./interfaces/IADXToken.sol";

contract ADXSupplyController {
	enum GovernanceLevel { None, Mint, All }

	uint public constant CAP = 150000000 * 1e18;
	// This amount was burned on purpose when migrating from Tom pool 2 (Staking with token 0xade) to Tom pool 3 (StakingPool with token 0xade) - 35m
	// another 10m burned from treasury and 2 we count as burned from the flash pool
	uint public immutable BURNED_MIN = 45000000 * 1e18;
	IADXToken public immutable ADX;

	mapping (address => uint8) public governance;
	// Some addresses (eg StakingPools) are incentivized with a certain allowance of ADX per year
	mapping (address => uint) public incentivePerSecond;
	// Keep track of when incentive tokens were last minted for a given addr
	mapping (address => uint) public incentiveLastMint;

	// Called (burn()) on every mintIncentive(): the StakingPoolLinearBurner of the legacy ADX-STAKING pool. Every pool calls
	// mintIncentive() before reading its own balance, so this keeps the legacy pool on its burn schedule right when it matters
	address public immutable burnHook;
	// The hook gets exactly this much gas, and can never make mintIncentive() fail
	uint public constant BURN_HOOK_GAS = 150000;
	// The hook runs at most once per block: within a block the burn schedule doesn't move, and a second call
	// (eg migrate() goes through both pools) would only add gas cost and variance
	uint public lastHookBlock;

	// governance is explicit (not msg.sender) because this is deployed through a CREATE2 factory
	constructor(IADXToken token, address initialGovernance, address _burnHook) {
		require(initialGovernance != address(0), "INVALID_GOVERNANCE");
		governance[initialGovernance] = uint8(GovernanceLevel.All);
		ADX = token;
		burnHook = _burnHook;
	}

	function changeSupplyController(address newSupplyController) external {
		require(governance[msg.sender] >= uint8(GovernanceLevel.All), "NOT_GOVERNANCE");
		ADX.changeSupplyController(newSupplyController);
	}

	function setGovernance(address addr, uint8 level) external {
		require(governance[msg.sender] >= uint8(GovernanceLevel.All), "NOT_GOVERNANCE");
		governance[addr] = level;
	}

	function setIncentive(address addr, uint amountPerSecond) external {
		require(governance[msg.sender] >= uint8(GovernanceLevel.All), "NOT_GOVERNANCE");
		// no more than 1 ADX per second
		require(amountPerSecond < 1e18, "AMOUNT_TOO_LARGE");
		incentiveLastMint[addr] = block.timestamp;
		incentivePerSecond[addr] = amountPerSecond;
		// AUDIT: pending incentive lost here
	}

	function innerMint(IADXToken token, address owner, uint amount) internal {
		// StakingPool calls mintIncentive() on every enter (no skipMint there), so a zero mint must never revert
		if (amount == 0) return;
		uint totalSupplyAfter = token.totalSupply() + amount;
		// ADX has no burn function: tokens are burned by sending them to address(0), which doesn't reduce totalSupply,
		// so we exclude them from the cap like the other burned/excluded amounts
		require(totalSupplyAfter <= CAP + BURNED_MIN
			+ token.balanceOf(address(0x23C2c34f38ce66ccC10E71e9bB2A06532D52C5E9))
			+ token.balanceOf(address(0)), "MINT_TOO_LARGE");
		token.mint(owner, amount);
	}

	// Kept because it"s used for ADXLoyaltyPool
	function mint(IADXToken token, address owner, uint amount) external {
		require(governance[msg.sender] >= uint8(GovernanceLevel.Mint), "NOT_GOVERNANCE");
		innerMint(token, owner, amount);
	}

	// Incentive mechanism
	function mintableIncentive(address addr) public view returns (uint) {
		return (block.timestamp - incentiveLastMint[addr]) * incentivePerSecond[addr];
	}

	function mintIncentive(address addr) external {
		uint amount = mintableIncentive(addr);
		incentiveLastMint[addr] = block.timestamp;
		innerMint(ADX, addr, amount);
		callBurnHook();
	}

	function callBurnHook() internal {
		address hook = burnHook;
		if (hook == address(0) || lastHookBlock == block.number) return;
		lastHookBlock = block.number;
		// Make sure the hook really gets BURN_HOOK_GAS (63/64 rule, plus the cost of the call itself). Otherwise gas estimation,
		// which looks for the lowest gas limit that doesn't revert, would settle on a limit where the hook silently runs out of gas
		require(gasleft() > BURN_HOOK_GAS + BURN_HOOK_GAS / 63 + 10000, "INSUFFICIENT_GAS");
		bytes4 selector = bytes4(keccak256("burn()"));
		// The result is ignored on purpose: the hook reverting (eg nothing to burn, or no longer the pool's guardian) must not affect us.
		// Assembly so that no return data gets copied, whatever the hook returns
		assembly {
			let ptr := mload(0x40)
			mstore(ptr, selector)
			pop(call(BURN_HOOK_GAS, hook, 0, ptr, 4, 0, 0))
		}
	}
}
