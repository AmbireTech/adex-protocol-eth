pragma solidity ^0.5.6;

contract IdentityFactory {
	event Deployed(address addr, uint256 salt);

	function deploy(bytes memory code, uint256 salt) public {
		address addr;
		assembly {
			addr := create2(0, add(code, 0x20), mload(code), salt)
		}
		require(
			addr != address(0),
			"FAILED_DEPLOYING"
		);

		emit Deployed(addr, salt);
	}
}
