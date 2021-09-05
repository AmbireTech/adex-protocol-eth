pragma solidity ^0.8.1;

interface IERC1271Wallet {
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}



library LibBytes {
  using LibBytes for bytes;

  // @TODO: see if we can just set .length = 
  function trimToSize(bytes memory b, uint newLen)
    internal
    pure
  {
    require(b.length > newLen, "only shrinking");
    assembly {
      mstore(b, newLen)
    }
  }


  /***********************************|
  |        Read Bytes Functions       |
  |__________________________________*/

  /**
   * @dev Reads a bytes32 value from a position in a byte array.
   * @param b Byte array containing a bytes32 value.
   * @param index Index in byte array of bytes32 value.
   * @return result bytes32 value from byte array.
   */
  function readBytes32(
    bytes memory b,
    uint256 index
  )
    internal
    pure
    returns (bytes32 result)
  {
    require(
      b.length >= index + 32,
      "LibBytes#readBytes32: GREATER_OR_EQUAL_TO_32_LENGTH_REQUIRED"
    );

    // Arrays are prefixed by a 256 bit length parameter
    index += 32;

    // Read the bytes32 from array memory
    assembly {
      result := mload(add(b, index))
    }
    return result;
  }
}


library SignatureValidator {
	using LibBytes for bytes;

	enum SignatureMode {
		NoSig,
		Caller,
		EIP712,
		EthSign,
		Wallet,
		// must be at the end
		Unsupported
	}

	// bytes4(keccak256("isValidSignature(bytes32,bytes)"))
	bytes4 constant internal ERC1271_MAGICVALUE_BYTES32 = 0x1626ba7e;

	function recoverAddr(bytes32 hash, bytes memory sig) internal view returns (address) {
		// @TODO sig len check
		// @TODO err messages
		require(sig.length >= 1, "sig len");
		uint8 modeRaw = uint8(sig[sig.length - 1]);
		require(modeRaw < uint8(SignatureMode.Unsupported), "unsupported sig mode");
		SignatureMode mode = SignatureMode(modeRaw);

		if (mode == SignatureMode.NoSig) {
			return address(0x0);
		}

		if (mode == SignatureMode.Caller) return msg.sender;
		if (mode == SignatureMode.EIP712 || mode == SignatureMode.EthSign) {
			// @TODO sig len check
			require(sig.length == 66, "sig len");
			bytes32 r = sig.readBytes32(0);
			bytes32 s = sig.readBytes32(32);
			// @TODO: is there a gas saving to be had here by using assembly?
			uint8 v = uint8(sig[64]);
			require(v == 27 || v == 28, "invalid v");
			if (mode == SignatureMode.EthSign) hash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
			return ecrecover(hash, v, r, s);
		}
		if (mode == SignatureMode.Wallet) {
			// @TODO: sig len check
			require(sig.length > 33, "sig len");
			// @TODO: can we pack the addr tigher into 20 bytes? should we?
			IERC1271Wallet wallet = IERC1271Wallet(address(uint160(uint256(sig.readBytes32(sig.length - 33)))));
			sig.trimToSize(sig.length - 33); // 32 bytes for the addr, 1 byte for the type
			require(ERC1271_MAGICVALUE_BYTES32 == wallet.isValidSignature(hash, sig), "invalid wallet sig");
			return address(wallet);
		}
		// @TODO: return 0?
	}

	function isValid(bytes32 hash, address signer, bytes memory sig) internal view returns (bool) {
		return recoverAddr(hash, sig) == signer;
	}
}
