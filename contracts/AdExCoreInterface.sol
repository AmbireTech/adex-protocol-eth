pragma solidity 0.4.25;

contract AdExCoreInterface {
	// @TODO events
	// @TODO: should public mappings be here?
	function deposit(address token, uint amount) external;
	function withdraw(address token, uint amount) external;
}