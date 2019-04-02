pragma solidity ^0.5.6;

import "./libs/SafeERC20.sol";

contract IdentityFactory {
	event LogDeployed(address addr, uint256 salt);

	address public relayer;
	constructor(address relayerAddr) public {
		relayer = relayerAddr;
	}

	function deploy(bytes memory code, uint256 salt) public {
		address addr;
		assembly { addr := create2(0, add(code, 0x20), mload(code), salt) }
		require(addr != address(0), "FAILED_DEPLOYING");
		emit LogDeployed(addr, salt);
	}

	function deployAndFund(bytes memory code, uint256 salt, address tokenAddr, uint256 tokenAmount) public {
		require(msg.sender == relayer, "ONLY_RELAYER");
		address addr;
		assembly { addr := create2(0, add(code, 0x20), mload(code), salt) }
		require(addr != address(0), "FAILED_DEPLOYING");
		SafeERC20.transfer(tokenAddr, addr, tokenAmount);
		emit LogDeployed(addr, salt);
	}
}
