pragma solidity ^0.5.13;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";

// AIP: https://github.com/AdExNetwork/aips/issues/18
// Quick overview:
// - it's divided into pools, each pool may represent a validator; it may represent something else too (for example, we may launch staking for publishers to prove their legitimacy)
// - the slasherAddr will be a multisig that will be controlled by the AdEx team - and later full control of the multisig will be given to a bridge to Polkadot, where we'll run the full on-chain slashing mechanism
//   - we will clearly communicate this migration path to our community and stakers
// - reward distribution is off-chain: depending on the pool, it may be done either via OUTPACE, via the Polkadot parachain, or via an auxilary contract that implements round-based reward distribution (you check into each round, the SC confirms you have a bond on Staking.sol, and you can withdraw your pro-rata earnings for the round)
// - each bond will be slashed relative to the time it bonded/unbonded; e.g. if the pool is slashed 12%, you bonded, then the pool was slashed 2%, then you unbonded, you'd only suffer a 2% slash

library BondLibrary {
	struct Bond {
		uint amount;
		bytes32 poolId;
		uint nonce;
	}

	function hash(Bond memory bond, address sender)
		internal
		view
		returns (bytes32)
	{
		return keccak256(abi.encode(
			address(this),
			sender,
			bond.amount,
			bond.poolId,
			bond.nonce
		));
	}
}

contract Staking {
	using SafeMath for uint;
	using BondLibrary for BondLibrary.Bond;

	struct BondState {
		bool active;
		uint64 slashedAtStart;
		uint64 willUnlock;
	}

	// Events
	event LogSlash(bytes32 indexed poolId, uint newSlashPts);
	event LogBond(address indexed owner, uint amount, bytes32 poolId, uint nonce, uint64 slashedAtStart);
	event LogUnbondRequested(address indexed owner, bytes32 indexed bondId, uint64 willUnlock);
	event LogUnbonded(address indexed owner, bytes32 indexed bondId);

	// could be 2**64 too, since we use uint64
	uint constant MAX_SLASH = 10 ** 18;
	uint constant TIME_TO_UNBOND = 30 days;
	address constant BURN_ADDR = address(0xaDbeEF0000000000000000000000000000000000);

	address public tokenAddr;
	address public slasherAddr;
	// Addressed by poolId
	mapping (bytes32 => uint) public slashPoints;
	// Addressed by bondId
	mapping (bytes32 => BondState) public bonds;

	constructor(address token, address slasher) public {
   		tokenAddr = token;
   		slasherAddr = slasher;
	}

	function slash(bytes32 poolId, uint pts) external {
		require(msg.sender == slasherAddr, 'ONLY_SLASHER');
		uint newSlashPts = slashPoints[poolId].add(pts);
		require(newSlashPts <= MAX_SLASH, 'PTS_TOO_HIGH');
		slashPoints[poolId] = newSlashPts;
		emit LogSlash(poolId, newSlashPts);
	}

	function addBond(BondLibrary.Bond memory bond) public {
		bytes32 id = bond.hash(msg.sender);
		require(!bonds[id].active, 'BOND_ALREADY_ACTIVE');
		require(slashPoints[bond.poolId] < MAX_SLASH, 'POOL_SLASHED');
		bonds[id] = BondState({
			active: true,
			slashedAtStart: uint64(slashPoints[bond.poolId]),
			willUnlock: 0
		});
		SafeERC20.transferFrom(tokenAddr, msg.sender, address(this), bond.amount);
		emit LogBond(msg.sender, bond.amount, bond.poolId, bond.nonce, bonds[id].slashedAtStart);
	}

	function requestUnbond(BondLibrary.Bond memory bond) public {
		bytes32 id = bond.hash(msg.sender);
		BondState storage bondState = bonds[id];
		require(bondState.active && bondState.willUnlock == 0, 'BOND_NOT_ACTIVE');
		bondState.willUnlock = uint64(now + TIME_TO_UNBOND);
		emit LogUnbondRequested(msg.sender, id, bondState.willUnlock);
	}

	function unbond(BondLibrary.Bond memory bond) public {
		bytes32 id = bond.hash(msg.sender);
		BondState storage bondState = bonds[id];
		require(bondState.willUnlock > 0 && now > bondState.willUnlock, 'BOND_NOT_UNLOCKED');
		uint amount = calcWithdrawAmount(bond, uint(bondState.slashedAtStart));
		uint toBurn = bond.amount - amount;
		delete bonds[id];
		SafeERC20.transfer(tokenAddr, msg.sender, amount);
		if (toBurn > 0) SafeERC20.transfer(tokenAddr, BURN_ADDR, toBurn);
		emit LogUnbonded(msg.sender, id);
	}

	function getWithdrawAmount(address owner, BondLibrary.Bond memory bond) public view returns (uint) {
		BondState storage bondState = bonds[bond.hash(owner)];
		if (!bondState.active) return 0;
		return calcWithdrawAmount(bond, uint(bondState.slashedAtStart));
	}

	function calcWithdrawAmount(BondLibrary.Bond memory bond, uint slashedAtStart) internal view returns (uint) {
		return bond.amount
			.mul(MAX_SLASH.sub(slashPoints[bond.poolId]))
			.div(MAX_SLASH.sub(slashedAtStart));
	}
}
