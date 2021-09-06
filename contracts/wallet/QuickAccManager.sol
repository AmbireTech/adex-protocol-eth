// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.1;

import "../Identityv5.2.sol";

contract QuickAccManager {
	// @TODO logs
	bytes4 immutable CANCEL_PREFIX = 0xc47c3100;
	// @TODO mutable timelock?
	uint immutable timelock = 4 days;
	mapping (address => uint) nonces;
	mapping (bytes32 => uint) enqueued;

	// @TODO consider replacing this with a tuple if we do not need anything else
	struct QuickAccount {
		address one;
		address two;
		// @TODO allow one to just skip the sig?
	}

	// @TODO security possible grieving vector
	// front-run this tx with only one of the valid signatures...
	function send(Identity identity, QuickAccount calldata acc, bytes calldata sigOne, bytes calldata sigTwo, Identity.Transaction[] calldata txns) external {
		bytes32 accHash = keccak256(abi.encode(acc));
		require(identity.privileges(address(this)) == accHash, 'WRONG_ACC_OR_NO_PRIV');
		// Security: we must also hash in the hash of the QuickAccount, otherwise the sig of one key can be reused across multiple accs
		bytes32 hash = keccak256(abi.encode(
			address(this),
			block.chainid,
			accHash,
			nonces[address(identity)]++,
			txns
		));
		bool validOne = acc.one == SignatureValidator.recoverAddr(hash, sigOne);
		bool validTwo = acc.two == SignatureValidator.recoverAddr(hash, sigTwo);
		if (validOne && validTwo) {
			identity.executeBySender(txns);
		} else {
			require(validOne || validTwo, 'NO_VALID');
			// no need to check whether `hash` is already set here cause of the incrementing nonce
			enqueued[hash] = block.timestamp + timelock;
			// @TODO log, also log who the validSigner was
		}
	}

	function cancel(Identity identity, QuickAccount calldata acc, uint nonce, Identity.Transaction[] calldata txns, bytes calldata sig) external {
		bytes32 accHash = keccak256(abi.encode(acc));
		require(identity.privileges(address(this)) == accHash, 'WRONG_ACC_OR_NO_PRIV');

		bytes32 hash = keccak256(abi.encode(CANCEL_PREFIX, address(this), block.chainid, accHash, nonce, txns));
		address signer = SignatureValidator.recoverAddr(hash, sig);
		require(signer == acc.one || signer == acc.two, 'INVALID_SIGNATURE');

		// @NOTE: should we allow cancelling even when it's matured?
		bytes32 hashTx = keccak256(abi.encode(address(this), block.chainid, accHash, nonce, txns));
		require(enqueued[hashTx] != 0 && block.timestamp < enqueued[hashTx], 'TOO_LATE');
		delete enqueued[hashTx];
		// @TODO: log
	}

	function execEnqueued(Identity identity, bytes32 accHash, uint nonce, Identity.Transaction[] calldata txns) external {
		bytes32 hash = keccak256(abi.encode(address(this), block.chainid, accHash, nonce, txns));
		require(enqueued[hash] != 0 && block.timestamp >= enqueued[hash], 'NOT_TIME');
		delete enqueued[hash];
		identity.executeBySender(txns);
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
}
