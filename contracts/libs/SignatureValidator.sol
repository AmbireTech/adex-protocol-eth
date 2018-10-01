pragma solidity 0.4.24;

library SignatureValidator {
	enum SignatureMode {
		NO_SIG,
		EIP712,
		GETH,
		TREZOR,
		ADEX
	}

	/// @dev Validates that a hash was signed by a specified signer.
	/// @param hash Hash which was signed.
	/// @param signer Address of the signer.
	/// @param signature ECDSA signature along with the mode [{mode}{v}, {r}, {s}]
	/// @return Returns whether signature is from a specified user.
	function isValidSignature(bytes32 hash, address signer, bytes32[3] signature) internal pure returns (bool) {
		SignatureMode mode = SignatureMode(uint8(signature[0][0]));

		if (mode == SignatureMode.NO_SIG) {
			return false;
		}

		uint8 v = uint8(signature[0][1]);

		if (mode == SignatureMode.GETH) {
			hash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
		} else if (mode == SignatureMode.TREZOR) {
			hash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n\x20", hash));
		} else if (mode == SignatureMode.ADEX) {
			hash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n99By signing this message, you acknowledge signing an AdEx bid with the hash:\n"));
		}

		return ecrecover(hash, v, signature[1], signature[2]) == signer;
	}
}
