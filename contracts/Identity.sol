pragma solidity ^0.5.6;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";
import "./libs/SignatureValidator.sol";
import "./libs/ChannelLibrary.sol";

contract ValidatorRegistry {
	// The contract will probably just use a mapping, but this is a generic interface
	function whitelisted(address) view external returns (bool);
}

contract Identity {
	using SafeMath for uint;

	// Storage
	// WARNING: be careful when modifying this
	// privileges and registryAddr must always be respectively the 0th and 1st thing in storage
	mapping (address => uint8) public privileges;
	address public registryAddr;
	// The next allowed nonce
	uint public nonce = 0;
	// Routine operations are authorized at once for a period, fee is paid once
	mapping (bytes32 => bool) public routinePaidFees;

	// Constants
	bytes4 private constant CHANNEL_WITHDRAW_SELECTOR = bytes4(keccak256('channelWithdraw((address,address,uint256,uint256,address[],bytes32),bytes32,bytes32[3][],bytes32[],uint256)'));
	bytes4 private constant CHANNEL_WITHDRAW_EXPIRED_SELECTOR = bytes4(keccak256('channelWithdrawExpired((address,address,uint256,uint256,address[],bytes32))'));
	bytes4 private constant CHANNEL_OPEN_SELECTOR = bytes4(keccak256('channelOpen((address,address,uint256,uint256,address[],bytes32))'));
	uint256 private CHANNEL_MAX_VALIDITY = 90 days;

	enum PrivilegeLevel {
		None,
		Routines,
		Transactions,
		Withdraw
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
		uint mode;
		bytes data;
	}

	constructor(address[] memory addrs, uint8[] memory privLevels, address regAddr)
		public
	{
		registryAddr = regAddr;
		uint len = privLevels.length;
		for (uint i=0; i<len; i++) {
			privileges[addrs[i]] = privLevels[i];
			emit LogPrivilegeChanged(addrs[i], privLevels[i]);
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

			executeCall(txn.to, txn.value, txn.data);
			// The actual anti-bricking mechanism - do not allow a signer to drop his own priviledges
			require(privileges[signer] >= uint8(PrivilegeLevel.Transactions), 'PRIVILEGE_NOT_DOWNGRADED');
		}
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, msg.sender, feeTokenAmount);
		}
	}

	function executeBySender(Transaction[] memory txns)
		public
	{
		require(privileges[msg.sender] >= uint8(PrivilegeLevel.Transactions), 'INSUFFICIENT_PRIVILEGE_SENDER');
		uint len = txns.length;
		for (uint i=0; i<len; i++) {
			Transaction memory txn = txns[i];
			require(txn.nonce == nonce, 'WRONG_NONCE');

			nonce = nonce.add(1);

			executeCall(txn.to, txn.value, txn.data);
		}
		// The actual anti-bricking mechanism - do not allow the sender to drop his own priviledges
		require(privileges[msg.sender] >= uint8(PrivilegeLevel.Transactions), 'PRIVILEGE_NOT_DOWNGRADED');
	}

	function executeRoutines(RoutineAuthorization memory auth, bytes32[3] memory signature, RoutineOperation[] memory operations)
		public
	{
		require(auth.identityContract == address(this), 'AUTHORIZATION_NOT_FOR_CONTRACT');
		require(auth.relayer == msg.sender, 'ONLY_RELAYER_CAN_CALL');
		require(auth.validUntil >= now, 'AUTHORIZATION_EXPIRED');
		bytes32 hash = keccak256(abi.encode(auth));
		address signer = SignatureValidator.recoverAddr(hash, signature);
		require(privileges[signer] >= uint8(PrivilegeLevel.Transactions), 'INSUFFICIENT_PRIVILEGE');
		uint len = operations.length;
		for (uint i=0; i<len; i++) {
			RoutineOperation memory op = operations[i];
			// @TODO: is it possible to preserve original error from the call
			if (op.mode == 0) {
				// Channel: Withdraw
				executeCall(auth.outpace, 0, abi.encodePacked(CHANNEL_WITHDRAW_SELECTOR, op.data));
			} else if (op.mode == 1) {
				// Channel: Withdraw Expired
				executeCall(auth.outpace, 0, abi.encodePacked(CHANNEL_WITHDRAW_EXPIRED_SELECTOR, op.data));
			} else if (op.mode == 2) {
				// Withdraw from identity
				(address tokenAddr, address to, uint amount) = abi.decode(op.data, (address, address, uint));
				require(privileges[to] >= uint8(PrivilegeLevel.Withdraw), 'INSUFFICIENT_PRIVILEGE_WITHDRAW');
				SafeERC20.transfer(tokenAddr, to, amount);
			} else if (op.mode == 3) {
				// Channel: open
				(ChannelLibrary.Channel memory channel) = abi.decode(op.data, (ChannelLibrary.Channel));
				// Ensure validity is sane
				require(channel.validUntil <= now + CHANNEL_MAX_VALIDITY);
				// Ensure all validators are whitelisted
				uint validatorsLen = channel.validators.length;
				for (uint j=0; j<validatorsLen; j++) {
					require(
						ValidatorRegistry(registryAddr).whitelisted(channel.validators[j]),
						"VALIDATOR_NOT_WHITELISTED"
					);
				}
				SafeERC20.approve(channel.tokenAddr, auth.outpace, 0);
				SafeERC20.approve(channel.tokenAddr, auth.outpace, channel.tokenAmount);
				executeCall(auth.outpace, 0, abi.encodePacked(CHANNEL_OPEN_SELECTOR, op.data));
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
	{
		assembly {
			let result := call(gas, to, value, add(data, 0x20), mload(data), 0, 0)

			switch result case 0 {
				let size := returndatasize
				let ptr := mload(0x40)
				returndatacopy(ptr, 0, size)
				revert(ptr, size)
			}
			default {}
		}
	}
}
