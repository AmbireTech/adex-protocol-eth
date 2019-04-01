pragma solidity ^0.5.6;

import "../libs/SafeERC20.sol";


contract IdentityProxy {
	// Storage: shared with Identity.sol
	// @TODO generate this from AST
	mapping (address => uint8) public privileges;
	address public registryAddr;

	constructor()
		public
	{
		// @TODO: this would all be codegen
		privileges[address(0xCAfEcAfeCAfECaFeCaFecaFecaFECafECafeCaFe)] = 3;
		registryAddr = address(0xCAfEcAfeCAfECaFeCaFecaFecaFECafECafeCaFe);
		// @TODO pay out fees
	}

	function () external
	{
		// @TODO: use the bottom snippet (from aragonOS)
		// @TODO test if it will preserve the error
		assembly {
			let masterCopy := and(sload(0), 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef)
			calldatacopy(0, 0, calldatasize())
			let success := delegatecall(gas, masterCopy, 0, calldatasize(), 0, 0)
			returndatacopy(0, 0, returndatasize())
			if eq(success, 0) { revert(0, returndatasize()) }
			return(0, returndatasize())
			/*
			// Taken from AragonOS
			let result := delegatecall(sub(gas, fwdGasLimit), _dst, add(_calldata, 0x20), mload(_calldata), 0, 0)
			let size := returndatasize
			let ptr := mload(0x40)
			returndatacopy(ptr, 0, size)

			switch result case 0 { revert(ptr, size) }
			default { return(ptr, size) }
			*/
		}
	}
}
