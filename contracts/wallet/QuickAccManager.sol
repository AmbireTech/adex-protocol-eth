// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.1;

import "../Identityv5.2.sol";
import "../interfaces/IERC20.sol";

contract QuickAccManager {
	// NOTE: timelock currently immutable
	uint immutable timelock = 4 days;
	mapping (address => uint) nonces;
	mapping (bytes32 => uint) scheduled;

	bytes4 immutable CANCEL_PREFIX = 0xc47c3100;

	// Events
	// we only need those for timelocked stuff so we can show scheduled txns to the user; the oens that get executed immediately do not need logs
	event LogScheduled(bytes32 indexed txnHash, bytes32 indexed accHash, address indexed signer, uint nonce, uint time, Identity.Transaction[] txns);
	event LogCancelled(bytes32 indexed txnHash, bytes32 indexed accHash, uint time);
	event LogExecScheduled(bytes32 indexed txnHash, bytes32 indexed accHash, uint time);

	// EIP 2612
	bytes32 public DOMAIN_SEPARATOR;
	constructor() {
		DOMAIN_SEPARATOR = keccak256(
			abi.encode(
				keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
				keccak256(bytes('QuickAccManager')),
				keccak256(bytes('1')),
				block.chainid,
				address(this)
			)
		);
	}

	struct QuickAccount {
		address one;
		address two;
		// We decided to not allow options here such as ability to skip the second sig for send(), but leaving this a struct rather than a tuple
		// for clarity and to ensure it's future proof
	}
	struct DualSig {
		bool isBothSigned;
		bytes one;
		bytes two;
	}

	// NOTE: a single accHash can control multiple identities, as long as those identities set it's hash in privileges[address(this)]
	// this is by design

	// isBothSigned is hashed in so that we don't allow signatures from two-sig txns to be reused for single sig txns,
	// ...potentially frontrunning a normal two-sig transaction and making it wait
	function send(Identity identity, QuickAccount calldata acc, DualSig calldata sigs, Identity.Transaction[] calldata txns) external {
		bytes32 accHash = keccak256(abi.encode(acc));
		require(identity.privileges(address(this)) == accHash, 'WRONG_ACC_OR_NO_PRIV');
		// Security: we must also hash in the hash of the QuickAccount, otherwise the sig of one key can be reused across multiple accs
		bytes32 hash = keccak256(abi.encode(
			address(this),
			block.chainid,
			accHash,
			nonces[address(identity)]++,
			txns,
			sigs.isBothSigned
		));
		if (sigs.isBothSigned) {
			require(acc.one == SignatureValidator.recoverAddr(hash, sigs.one), 'SIG_ONE');
			require(acc.two == SignatureValidator.recoverAddr(hash, sigs.two), 'SIG_TWO');
			identity.executeBySender(txns);
		} else {
			address signer = SignatureValidator.recoverAddr(hash, sigs.one);
			require(acc.one == signer || acc.two == signer, 'SIG');
			// no need to check whether `scheduled[hash]` is already set here cause of the incrementing nonce
			scheduled[hash] = block.timestamp + timelock;
			emit LogScheduled(hash, accHash, signer, nonces[address(identity)], block.timestamp, txns);
		}
	}

	function cancel(Identity identity, QuickAccount calldata acc, uint nonce, bytes calldata sig, Identity.Transaction[] calldata txns) external {
		bytes32 accHash = keccak256(abi.encode(acc));
		require(identity.privileges(address(this)) == accHash, 'WRONG_ACC_OR_NO_PRIV');

		bytes32 hash = keccak256(abi.encode(CANCEL_PREFIX, address(this), block.chainid, accHash, nonce, txns, false));
		address signer = SignatureValidator.recoverAddr(hash, sig);
		require(signer == acc.one || signer == acc.two, 'INVALID_SIGNATURE');

		// @NOTE: should we allow cancelling even when it's matured? probably not, otherwise there's a minor grief
		// opportunity: someone wants to cancel post-maturity, and you front them with execScheduled
		bytes32 hashTx = keccak256(abi.encode(address(this), block.chainid, accHash, nonce, txns));
		require(scheduled[hashTx] != 0 && block.timestamp < scheduled[hashTx], 'TOO_LATE');
		delete scheduled[hashTx];

		emit LogCancelled(hashTx, accHash, block.timestamp);
	}

	function execScheduled(Identity identity, bytes32 accHash, uint nonce, Identity.Transaction[] calldata txns) external {
		bytes32 hash = keccak256(abi.encode(address(this), block.chainid, accHash, nonce, txns, false));
		require(scheduled[hash] != 0 && block.timestamp >= scheduled[hash], 'NOT_TIME');
		delete scheduled[hash];
		identity.executeBySender(txns);

		emit LogExecScheduled(hash, accHash, block.timestamp);
	}

	// EIP 1271 implementation
	// see https://eips.ethereum.org/EIPS/eip-1271
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
		(address payable id, bytes memory sig1, bytes memory sig2) = abi.decode(signature, (address, bytes, bytes));
		bytes32 accHash = keccak256(abi.encode(QuickAccount({
			one: SignatureValidator.recoverAddr(hash, sig1),
			two: SignatureValidator.recoverAddr(hash, sig2)
		})));
		if (Identity(id).privileges(address(this)) == accHash) {
			// bytes4(keccak256("isValidSignature(bytes32,bytes)")
			return 0x1626ba7e;
		} else {
			return 0xffffffff;
		}
	}

	// EIP 712 methods
	// all of the following are 2/2 only
	bytes32 public TRANSFER_TYPEHASH = keccak256("Transfer(address tokenAddr,address to,uint256 value,uint256 nonce)");
	struct Transfer { address token; address to; uint amount; }
	function sendTransfer(Identity identity, QuickAccount calldata acc, bytes calldata sigOne, bytes calldata sigTwo, Transfer calldata t) external {
		bytes32 accHash = keccak256(abi.encode(acc));
		require(identity.privileges(address(this)) == accHash, 'WRONG_ACC_OR_NO_PRIV');

		bytes32 hash = keccak256(abi.encodePacked(
			'\x19\x01',
			DOMAIN_SEPARATOR,
			keccak256(abi.encode(TRANSFER_TYPEHASH, t.token, t.to, t.amount, nonces[address(identity)]++))
		));
		require(acc.one == SignatureValidator.recoverAddr(hash, sigOne), 'SIG_ONE');
		require(acc.two == SignatureValidator.recoverAddr(hash, sigTwo), 'SIG_TWO');
		Identity.Transaction[] memory txns = new Identity.Transaction[](1);
		txns[0].to = t.token;
		txns[0].data = abi.encodeWithSelector(IERC20.transfer.selector, t.to, t.amount);
		identity.executeBySender(txns);
	}

}
