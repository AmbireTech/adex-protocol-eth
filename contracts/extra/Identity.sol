pragma solidity ^0.5.0;
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
	// @TODO

	// Transaction structure
	// Those can be executed by keys with >= PrivilegeLevel.Transactions
	// Even though the contract cannot receive ETH, we are able to send ETH (.value), cause ETH might've been sent to the contract address before it's deployed
	// @TODO read other implementations of metatx
	struct Transaction {
		address identityContract;
		uint nonce;
		address feeTokenAddr;
		uint feeTokenAmount;
		address to;
		uint value;
		bytes data;
	}

	// routine authorizations allow the user to authorize (via keys >= PrivilegeLevel.Routines) a particular relayer to do any number of routines
	// those routines are safe: e.g. withdrawing channels to the identity, or from the identity to the pre-approved withdraw (>= PrivilegeLevel.Withdraw) address
	// while the fee will be paid only once per authorization, the authorization can be used until validUntil
	// while the routines are safe, there is some level of implied trust as the relayer may run executeRoutines without any routines to claim the fee
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
		bytes data;
	}

	constructor(address addr, uint8 privLevel, address feeTokenAddr, address feeBeneficiery, uint feeTokenAmount) public {
		privileges[addr] = privLevel;
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, feeBeneficiery, feeTokenAmount);
		}
	}

	function execute(Transaction[] memory txns, bytes32[3][] memory signatures)
		public
	{
		address feeTokenAddr = txns[0].feeTokenAddr;
		uint feeTokenAmount = 0;
		for (uint i=0; i<txns.length; i++) {
			Transaction memory txn = txns[i];
			//bytes32 hash = keccak256(abi.encode(txn));
			// @TODO: riperoni, fix this; without `bytes`-typed fields, it's the same
			bytes32 hash = keccak256(abi.encode(txn.identityContract, txn.nonce, txn.feeTokenAddr, txn.feeTokenAmount, txn.to, txn.value, txn.data));
			address signer = SignatureValidator.recoverAddr(hash, signatures[i]);

			require(txn.identityContract == address(this), 'TRANSACTION_NOT_FOR_CONTRACT');
			require(txn.feeTokenAddr == feeTokenAddr, 'EXECUTE_NEEDS_SINGLE_TOKEN');
			require(txn.nonce == nonce, 'WRONG_NONCE');
			require(privileges[signer] >= uint8(PrivilegeLevel.Transactions), 'INSUFFICIENT_PRIVILEGE');

			nonce++;
			feeTokenAmount = feeTokenAmount.add(txn.feeTokenAmount);

			require(executeCall(txn.to, txn.value, txn.data), 'CALL_FAILED');
		}
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, msg.sender, feeTokenAmount);
		}
	}

	function setAddrPrivilege(address addr, uint8 priv)
		external
	{
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		// @TODO: should we have on-chain anti-bricking guarantees? maybe there's an easy way to do this
		privileges[addr] = priv;
	}

	function executeRoutines(RoutineAuthorization memory authorization, bytes32[3] memory signature, RoutineOperation[] memory operations)
		public
	{
		require(authorization.relayer == msg.sender, 'ONLY_RELAYER_CAN_CALL');
		require(authorization.identityContract == address(this), 'AUTHORIZATION_NOT_FOR_CONTRACT');
		require(now >= authorization.validUntil, 'AUTHORIZATION_EXPIRED');
		bytes32 hash = keccak256(abi.encode(authorization));
		address signer = SignatureValidator.recoverAddr(hash, signature);
		require(privileges[signer] >= uint8(PrivilegeLevel.Routines), 'INSUFFICIENT_PRIVILEGE');
		for (uint i=0; i<operations.length; i++) {
			RoutineOperation memory op = operations[i];
			// @TODO: is it possible to preserve original error from the call
			if (op.mode == 0) {
				// Channel: Withdraw
				// @TODO: security: if authorization.outpace is malicious somehow, it can re-enter and maaaybe double spend the fee? think about it
				bool success = executeCall(authorization.outpace, 0, abi.encodePacked(CHANNEL_WITHDRAW_SELECTOR, op.data));
				require(success, 'WITHDRAW_FAILED');
			} else if (op.mode == 1) {
				// Channel: Withdraw Expired
				bool success = executeCall(authorization.outpace, 0, abi.encodePacked(CHANNEL_WITHDRAW_EXPIRED_SELECTOR, op.data));
				require(success, 'WITHDRAW_EXPIRED_FAILED');
			} else if (op.mode == 2) {
				// Withdraw from identity
				(address tokenAddr, address to, uint amount) = abi.decode(op.data, (address, address, uint));
				require(privileges[to] >= uint8(PrivilegeLevel.Withdraw), 'INSUFFICIENT_PRIVILEGE_WITHDRAW');
				SafeERC20.transfer(tokenAddr, to, amount);
			} else {
				require(false, 'INVALID_MODE');
			}
		}
		if (!routinePaidFees[hash] && authorization.feeTokenAmount > 0) {
			routinePaidFees[hash] = true;
			SafeERC20.transfer(authorization.feeTokenAddr, msg.sender, authorization.feeTokenAmount);
		}
	}

	// copied from https://github.com/uport-project/uport-identity/blob/develop/contracts/Proxy.sol
	// there's also
	// https://github.com/gnosis/MultiSigWallet/commit/e1b25e8632ca28e9e9e09c81bd20bf33fdb405ce
	// https://github.com/austintgriffith/bouncer-proxy/blob/master/BouncerProxy/BouncerProxy.sol
	// https://github.com/gnosis/safe-contracts/blob/7e2eeb3328bb2ae85c36bc11ea6afc14baeb663c/contracts/base/Executor.sol
	function executeCall(address to, uint256 value, bytes memory data)
		internal
		returns (bool success)
	{
		assembly {
			success := call(gas, to, value, add(data, 0x20), mload(data), 0, 0)
		}
	}
}
