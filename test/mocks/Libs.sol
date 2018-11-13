pragma solidity ^0.4.25;

import "../../contracts/libs/SignatureValidator.sol";

contract Libs {
	function isValidSig(bytes32 hash, address signer, bytes32[3] sig) public pure returns (bool) {
		return SignatureValidator.isValidSignature(hash, signer, sig);
	}
}
