pragma solidity ^0.5.6;

import "../libs/SafeERC20.sol";

contract IdentityProxy {
	// Storage: shared with Identity.sol
	// Storage
	mapping (address => uint8) public privileges;
	address public registryAddr;
	// The next allowed nonce
	uint public nonce = 0;
	// Routine operations are authorized at once for a period, fee is paid once
	mapping (bytes32 => bool) public routinePaidFees;

	constructor()
		public
	{
		// @TODO: this would all be codegen
		privileges[address(0xCAfEcAfeCAfECaFeCaFecaFecaFECafECafeCaFe)] = 3;
		registryAddr = address(0xCAfEcAfeCAfECaFeCaFecaFecaFECafECafeCaFe);
		// token, beneficiery, amount
		SafeERC20.transfer(address(0xdEADCAfEDeaDCAfeDeadCafEdEAdcaFEDEAdcAFe), address(0xCAFeDeaDcAFedeAdcaFedEADCAFEDeADcafedead), uint256(0xBAADA555BAADA555BAADA555BAADA555BAADA555BAADA555BAADA555BAADA555));
	}

	function () external
	{
		// @TODO: use the bottom snippet (from aragonOS)
		// @TODO test if it will preserve the error
		assembly {
			// Taken from AragonOS
			let masterCopy := and(sload(0), 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF)
			calldatacopy(0, 0, calldatasize())
			let result := delegatecall(sub(gas, 10000), masterCopy, 0, calldatasize(), 0, 0)
			let size := returndatasize
			let ptr := mload(0x40)
			returndatacopy(ptr, 0, size)

			switch result case 0 { revert(ptr, size) }
			default { return(ptr, size) }
		}
	}
}
