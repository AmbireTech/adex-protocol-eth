pragma solidity ^0.5.6;

contract Registry {
	mapping (address => bool) public whitelisted;

	// The owner will be changed to a SC that bridges into a polkadot praachain,
	// once the full AdEx Registry is running
	address public owner;
	constructor() public {
		owner = msg.sender;
	}

	function changeOwner(address newOwner) public {
		require(msg.sender == owner, "ONLY_OWNER");
		owner = newOwner;
	}

	function setWhitelisted(address addr, bool isWhitelisted) public {
		require(msg.sender == owner, "ONLY_OWNER");
		whitelisted[addr] = isWhitelisted;
	}
}
