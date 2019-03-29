pragma solidity ^0.5.6;
pragma experimental ABIEncoderV2;

import "../libs/SafeMath.sol";
import "../libs/SafeERC20.sol";
import "../libs/SignatureValidator.sol";
import "../AdExCore.sol";
import "../libs/ChannelLibrary.sol";

contract ValidatorRegistry {
	// The contract will probably just use a mapping, but this is a generic interface
	function whitelisted(address) view external returns (bool);
}

contract Identity {
	using SafeMath for uint;

	// Constants
	bytes4 private CHANNEL_WITHDRAW_SELECTOR = AdExCore(0x0).channelWithdraw.selector;
	bytes4 private CHANNEL_WITHDRAW_EXPIRED_SELECTOR = AdExCore(0x0).channelWithdrawExpired.selector;
	bytes4 private CHANNEL_OPEN_SELECTOR = AdExCore(0x0).channelOpen.selector;

	// The next allowed nonce
	uint public nonce = 0;
	mapping (address => uint8) public privileges;
	// Routine operations are authorized at once for a period, fee is paid once
	mapping (bytes32 => bool) public routinePaidFees;
	address public registryAddr;

	enum PrivilegeLevel {
		None,
		Routines,
		Transactions,
		Withdraw
	}

	enum ChannelMode {
		Withdraw,
		WithdrawExpired,
		WithdrawIdentity,
		Open
	}

	// Events
	event LogPrivilegeChanged(address indexed addr, uint8 privLevel);

	// Transaction structure
	// Those can be executed by keys with >= PrivilegeLevel.Transactions
	// Even though the contract cannot receive ETH, we are able to send ETH (.value), cause ETH might've been sent to the contract address before it's deployed
	struct Transaction {
		// replay protection
		address identityContract;
		uint nonce;
		// tx fee, in tokens
		address feeTokenAddr;
		uint feeTokenAmount;
		// all the regular txn data
		address to;
		uint value;
		bytes data;
	}

	// RoutineAuthorizations allow the user to authorize (via keys >= PrivilegeLevel.Routines) a particular relayer to do any number of routines
	// those routines are safe: e.g. withdrawing channels to the identity, or from the identity to the pre-approved withdraw (>= PrivilegeLevel.Withdraw) address
	// while the fee will be paid only ONCE per auth, the authorization can be used until validUntil
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
		uint8 mode;
		bytes data;
	}

	constructor(address feeTokenAddr, address feeBeneficiery, uint feeTokenAmount, address[] memory addrs, uint8[] memory privLevels, address regAddr)
		public
	{
		registryAddr = regAddr;
		uint len = privLevels.length;
		for (uint i=0; i<len; i++) {
			privileges[addrs[i]] = privLevels[i];
			emit LogPrivilegeChanged(addrs[i], privLevels[i]);
		}
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, feeBeneficiery, feeTokenAmount);
		}
	}

	function setAddrPrivilege(address addr, uint8 privLevel)
		external
	{
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');

		// @TODO: should we have on-chain anti-bricking guarantees? maybe there's an easy way to do this
		// since this can only be invoked by PrivilegeLevels.Transaction, maybe if we make sure we can't invoke setAddrPrivilege(addr, level) where addr == signer, it may be sufficient
		privileges[addr] = privLevel;
		emit LogPrivilegeChanged(addr, privLevel);
	}

	function execute(Transaction[] memory txns, bytes32[3][] memory signatures)
		public
	{
		address feeTokenAddr = txns[0].feeTokenAddr;
		uint feeTokenAmount = 0;
		uint len = txns.length;
		for (uint i=0; i<len; i++) {
			Transaction memory txn = txns[i];
			require(txn.identityContract == address(this), 'TRANSACTION_NOT_FOR_CONTRACT');
			require(txn.feeTokenAddr == feeTokenAddr, 'EXECUTE_NEEDS_SINGLE_TOKEN');
			require(txn.nonce == nonce, 'WRONG_NONCE');

			// If we use the naive abi.encode(txn) and have a field of type `bytes`,
			// there is a discrepancy between ethereumjs-abi and solidity
			// if we enter every field individually, in order, there is no discrepancy
			//bytes32 hash = keccak256(abi.encode(txn));
			bytes32 hash = keccak256(abi.encode(txn.identityContract, txn.nonce, txn.feeTokenAddr, txn.feeTokenAmount, txn.to, txn.value, txn.data));
			address signer = SignatureValidator.recoverAddr(hash, signatures[i]);

			require(privileges[signer] >= uint8(PrivilegeLevel.Transactions), 'INSUFFICIENT_PRIVILEGE_TRANSACTION');

			nonce = nonce.add(1);
			feeTokenAmount = feeTokenAmount.add(txn.feeTokenAmount);

			require(executeCall(txn.to, txn.value, txn.data), 'CALL_FAILED');
			// The actual anti-bricking mechanism - do not allow a signer to drop his own priviledges
			require(privileges[signer] >= uint8(PrivilegeLevel.Transactions), 'PRIVILEGE_NOT_DOWNGRADED');
		}
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, msg.sender, feeTokenAmount);
		}
	}

	function executeRoutines(RoutineAuthorization memory auth, bytes32[3] memory signature, RoutineOperation[] memory operations)
		public
	{
		require(auth.identityContract == address(this), 'AUTHORIZATION_NOT_FOR_CONTRACT');
		require(auth.relayer == msg.sender, 'ONLY_RELAYER_CAN_CALL');
		require(auth.validUntil >= now, 'AUTHORIZATION_EXPIRED');
		bytes32 hash = keccak256(abi.encode(auth));
		address signer = SignatureValidator.recoverAddr(hash, signature);
		require(privileges[signer] >= uint8(PrivilegeLevel.Routines), 'INSUFFICIENT_PRIVILEGE');
		uint len = operations.length;
		for (uint i=0; i<len; i++) {
			RoutineOperation memory op = operations[i];
			// @TODO: is it possible to preserve original error from the call
			if (op.mode == uint8(ChannelMode.Withdraw)) {
				// Channel: Withdraw
				bool success = executeCall(auth.outpace, 0, abi.encodePacked(CHANNEL_WITHDRAW_SELECTOR, op.data));
				require(success, 'WITHDRAW_FAILED');
			} else if (op.mode == uint8(ChannelMode.WithdrawExpired)) {
				// Channel: Withdraw Expired
				bool success = executeCall(auth.outpace, 0, abi.encodePacked(CHANNEL_WITHDRAW_EXPIRED_SELECTOR, op.data));
				require(success, 'WITHDRAW_EXPIRED_FAILED');
			} else if (op.mode == uint8(ChannelMode.WithdrawIdentity)) {
				// Withdraw from identity
				(address tokenAddr, address to, uint amount) = abi.decode(op.data, (address, address, uint));
				require(privileges[to] >= uint8(PrivilegeLevel.Withdraw), 'INSUFFICIENT_PRIVILEGE_WITHDRAW');
				SafeERC20.transfer(tokenAddr, to, amount);
			} else if (op.mode == uint8(ChannelMode.Open)) {
				// Channel: open
				(ChannelLibrary.Channel memory channel) = abi.decode(op.data, (ChannelLibrary.Channel));
				// Ensure all validators are whitelisted
				uint validatorsLen = channel.validators.length;
				for (uint j=0; j<validatorsLen; j++) {
					require(
						ValidatorRegistry(registryAddr).whitelisted(channel.validators[j]),
						"VALIDATOR_NOT_WHITELISTED"
					);
				}
				bool success = executeCall(auth.outpace, 0, abi.encodePacked(CHANNEL_OPEN_SELECTOR, op.data));
				require(success, 'OPEN_FAILED');
			} else {
				require(false, 'INVALID_MODE');
			}
		}
		if (!routinePaidFees[hash] && auth.feeTokenAmount > 0) {
			routinePaidFees[hash] = true;
			SafeERC20.transfer(auth.feeTokenAddr, msg.sender, auth.feeTokenAmount);
		}
	}

	// we shouldn't use address.call(), cause: https://github.com/ethereum/solidity/issues/2884
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
