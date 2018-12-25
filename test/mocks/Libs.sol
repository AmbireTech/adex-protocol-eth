pragma solidity ^0.5.0;

import "../../contracts/libs/SignatureValidator.sol";

contract Libs {
	function isValidSig(bytes32 hash, address signer, bytes32[3] memory sig) public pure returns (bool) {
		return SignatureValidator.isValidSignature(hash, signer, sig);
	}
}
