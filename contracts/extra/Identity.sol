pragma solidity ^0.4.25;
pragma experimental ABIEncoderV2;

import "../libs/SafeMath.sol";
import "../libs/SafeERC20.sol";
import "../libs/SignatureValidator.sol";
import "../interfaces/AdExCoreInterface.sol";

contract Identity {
	using SafeMath for uint;

	// Constants
	bytes4 private CHANNEL_WITHDRAW_SELECTOR = AdExCoreInterface(0x0).channelWithdraw.selector;
	bytes4 private CHANNEL_WITHDRAW_EXPIRED_SELECTOR = AdExCoreInterface(0x0).channelWithdrawExpired.selector;

	// The next allowed nonce
	uint public nonce = 0;
	mapping (address => uint8) public privileges;
	// Routine operations are authorized at once for a period, fee is paid once
	mapping (bytes32 => bool) private routinePaidFees;

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
		// @TODO should we have an amount?
		address feeTokenAddr;
		uint feeTokenAmount;
		address to;
		bytes data;
	}
	// routine authorizations allow the user to authorize (via keys >= PrivilegeLevel.Routines) a particular relayer to do any number of routines
	// those routines are safe: e.g. withdrawing channels to the identity, or from the identity to the pre-approved withdraw (>= PrivilegeLevel.Withdraw) address
	// while the fee will be paid only once per authorization, the authorization can be used until validUntil
	// while the routines are safe, there is implied trust as the relayer may run executeRoutines without any routines to claim the fee
	struct RoutineAuthorization {
		address identityContract;
		address relayer;
		address outpace;
		uint validUntil;
		address feeTokenAddr;
		uint feeTokenAmount;
	}
	struct RoutineOperation {
		uint mode;
		bytes32[] data;
	}

	constructor(address addr, uint8 privLevel) public {
		privileges[addr] = privLevel;
		// @TODO: deployer fees
		// @TODO: or, alternatively, handle deploy fees in the factory; although that will be tough cause msg.sender needs to be this contract
	}

	modifier onlyIdentity() {
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		_;
	}

	function execute(Transaction[] memory transactions, bytes32[3][] memory signatures)
		public
	{
		address feeTokenAddr = transactions[0].feeTokenAddr;
		uint feeTokenAmount = 0;
		for (uint i=0; i<transactions.length; i++) {
			Transaction memory transaction = transactions[i];
			//bytes32 hash = keccak256(abi.encode(transaction));
			// riperoni
			bytes32 hash = keccak256(abi.encode(transaction.identityContract, transaction.nonce, transaction.feeTokenAddr, transaction.feeTokenAmount, transaction.to, transaction.data));
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
		// @TODO: should we have on-chain anti-bricking guarantees? maybe there's an easy way to do this
		privileges[addr] = priv;
	}

	function executeRoutines(RoutineAuthorization memory authorization, bytes32[3] signature, RoutineOperation[] memory operations)
		public
	{
		require(authorization.relayer == msg.sender, 'ONLY_RELAYER_CAN_CALL');
		require(authorization.identityContract == address(this), 'AUTHORIZATION_NOT_FOR_CONTRACT');
		bytes32 hash = keccak256(abi.encode(authorization));
		address signer = SignatureValidator.recoverAddr(hash, signature);
		require(privileges[signer] >= uint8(PrivilegeLevel.Routines), 'INSUFFICIENT_PRIVILEGE');
		require(now >= authorization.validUntil, 'AUTHORIZATION_EXPIRED');
		for (uint i=0; i<operations.length; i++) {
			RoutineOperation memory op = operations[i];
			if (op.mode == 0) {
				// Channel: Withdraw
				// @TODO: security: if authorization.outpace is malicious somehow, it can re-enter and maaaybe double spend the fee? think about it
				require(authorization.outpace.call(CHANNEL_WITHDRAW_SELECTOR, op.data));
			} else if (op.mode == 1) {
				// Channel: Withdraw Expired
				require(authorization.outpace.call(CHANNEL_WITHDRAW_EXPIRED_SELECTOR, op.data));
			} else if (op.mode == 2) {
				// Withdraw from identity
				address tokenAddr = address(op.data[0]);
				address to = address(op.data[1]);
				uint amount = uint(op.data[2]);
				require(privileges[to] >= uint8(PrivilegeLevel.Withdraw), 'INSUFFICIENT_PRIVILEGE_WITHDRAW');
				SafeERC20.transfer(tokenAddr, to, amount);
			} else {
				require(false, 'INVALID_MODE');
			}
		}
		if (!routinePaidFees[hash]) {
			routinePaidFees[hash] = true;
			SafeERC20.transfer(authorization.feeTokenAddr, msg.sender, authorization.feeTokenAmount);
		}
	}
}
