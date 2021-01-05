// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;

import "../libs/SignatureValidator.sol";

contract Libs {
	function isValidSig(bytes32 hash, address signer, bytes32[3] memory sig) public pure returns (bool) {
		return SignatureValidator.isValidSignature(hash, signer, sig);
	}
}
