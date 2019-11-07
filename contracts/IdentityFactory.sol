pragma solidity ^0.5.6;
pragma experimental ABIEncoderV2;

import "./Identity.sol";

contract IdentityFactory {
	event LogDeployed(address addr, uint256 salt);

	address public relayer;
	constructor(address relayerAddr) public {
		relayer = relayerAddr;
	}

	function deploy(bytes memory code, uint256 salt) public {
		address addr = deploySafe(code, salt);
		emit LogDeployed(addr, salt);
	}
	function deployAndExecute(bytes memory code, uint256 salt, Identity.Transaction[] memory txns, bytes32[3][] memory signatures) public {
		address addr = deploySafe(code, salt);
		Identity(addr).execute(txns, signatures);
		emit LogDeployed(addr, salt);
	}
	function deployAndExecRoutines(bytes memory code, uint256 salt, Identity.RoutineAuthorization memory auth, Identity.RoutineOperation[] memory operations) public {
		address addr = deploySafe(code, salt);
		Identity(addr).executeRoutines(auth, operations);
		emit LogDeployed(addr, salt);
	}


	function withdraw(address tokenAddr, address to, uint256 tokenAmount) public {
		require(msg.sender == relayer, "ONLY_RELAYER");
		SafeERC20.transfer(tokenAddr, to, tokenAmount);
	}

	// This is done to mitigate possible frontruns where, for example, deploying the same code/salt via deploy()
	// would make a pending deployAndFund fail
	// The way we mitigate that is by checking if the contract is already deployed and if so, we continue execution
	function deploySafe(bytes memory code, uint256 salt) internal returns (address) {
		address expectedAddr = address(uint160(uint256(
			keccak256(abi.encodePacked(byte(0xff), address(this), salt, keccak256(code)))
		)));
		uint size;
		assembly { size := extcodesize(expectedAddr) }
		// If there is code at that address, we can assume it's the one we were about to deploy,
		// because of how CREATE2 and keccak256 works
		if (size == 0) {
			address addr;
			assembly { addr := create2(0, add(code, 0x20), mload(code), salt) }
			require(addr != address(0), "FAILED_DEPLOYING");
			require(addr == expectedAddr, "FAILED_MATCH");
		}
		return expectedAddr;
	}
}
