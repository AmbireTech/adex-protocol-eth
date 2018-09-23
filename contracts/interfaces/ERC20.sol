pragma solidity 0.4.24;

interface ERC20 {
	function transfer(address to, uint256 value) external returns (bool success);
	function transferFrom(address from, address to, uint256 value) external returns (bool success);
	function approve(address spender, uint256 value) external returns (bool success);
}
