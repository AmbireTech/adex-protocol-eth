pragma solidity ^0.4.25;
pragma experimental ABIEncoderV2;

import "../libs/SafeMath.sol";
import "../libs/SafeERC20.sol";
import "../libs/SignatureValidator.sol";

contract Identity {
	using SafeMath for uint;

	// The next allowed nonce
	uint public nonce = 0;
	mapping (address => uint8) public privileges;

	mapping (bytes32 => bool) private routineAuthorizationPaidFees;

	enum PrivilegeLevel {
		None,
		Routines,
		Transactions,
		Withdraw
	}

	// Events

	// Transaction structure
	// Those can be executed by keys with >= PrivilegeLevel.Transactions
	// @TODO read other implementations of metatx
	struct Transaction {
		address identityContract;
		uint nonce;
		address to;
		bytes data;
		// @TODO should we have an amount?
		address feeTokenAddr;
		uint feeTokenAmount;
	}
	// routine authorizations allow the user to authorize (via keys >= PrivilegeLevel.Routines) a particular relayer to do any number of routines
	// those routines are safe: e.g. withdrawing channels to the identity, or from the identity to the pre-approved withdraw (>= PrivilegeLevel.Withdraw) address
	// while the fee will be paid only once per authorization, the authorization can be used until validUntil
	// while the routines are safe, there is implied trust as the relayer may run executeRoutines without any routines to claim the fee
	struct RoutineAuthorization {
		address identityContract;
		address relayer;
		uint validUntil;
		address feeTokenAddr;
		uint feeTokenAmount;
	}
	struct RoutineOperation {
		// @TODO
	}

	constructor(address addr, uint8 privLevel) public {
		privileges[addr] = privLevel;
		// @TODO: deployer fees
		// @TODO: or, alternatively, handle deploy fees in the factory
	}

	modifier onlyIdentity() {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		_;
	}

	function execute(Transaction[] memory transactions, bytes32[3][] memory signatures) public {
		address feeTokenAddr = transactions[0].feeTokenAddr;
		uint feeTokenAmount = 0;
		for (uint i=0; i<transactions.length; i++) {
			Transaction memory transaction = transactions[i];
			bytes32 hash = keccak256(abi.encode(transaction));
			address signer = SignatureValidator.recoverAddr(hash, signatures[i]);

			require(transaction.identityContract == address(this), 'TRANSACTION_NOT_FOR_CONTRACT');
			require(transaction.feeTokenAddr == feeTokenAddr, 'EXECUTE_NEEDS_SINGLE_TOKEN');
			require(transaction.nonce == nonce, 'WRONG_NONCE');
			require(privileges[signer] >= uint8(PrivilegeLevel.Transactions), 'INSUFFICIENT_PRIVILEGE');

			nonce++;
			feeTokenAmount = feeTokenAmount.add(transaction.feeTokenAmount);

			// @TODO perhaps look at the gnosis external_call: https://github.com/gnosis/MultiSigWallet/blob/master/contracts/MultiSigWallet.sol#L244
			// https://github.com/gnosis/MultiSigWallet/commit/e1b25e8632ca28e9e9e09c81bd20bf33fdb405ce
			require(transaction.to.call(transaction.data));
		}
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, msg.sender, feeTokenAmount);
		}
	}

	function setAddrPrivilege(address addr, uint8 priv)
		external
		onlyIdentity
	{
		privileges[addr] = priv;
	}

	// routines: withdraw (but check privilege of withdraw to addr), withdraw from channel, withdraw expired, perhaps opening channels (with predefined validators)
	// @TODO low privilege things/predefines
	// @TODO transaction scheduling
	// design #1: one authorization, for a time period, with a fee; predefined calls; withdraws
	// design #2: part of the Transaction: certain calls will be allowed with lower privilege keys
}
