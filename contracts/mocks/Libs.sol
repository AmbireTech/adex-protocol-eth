// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

import "../libs/SignatureValidator.sol";

contract Libs {
	function isValidSig(bytes32 hash, address signer, bytes32[3] memory sig) public pure returns (bool) {
		return SignatureValidator.isValid(hash, signer, sig);
	}
}
