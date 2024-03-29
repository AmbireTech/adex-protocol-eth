// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

import "../libs/SafeERC20.sol";

contract ADXToken {
	// Constants
	string public constant name = "AdEx Network";
	string public constant symbol = "ADX";
	uint8 public constant decimals = 18;

	// Mutable variables
	uint public totalSupply;
	mapping(address => uint) balances;
	mapping(address => mapping(address => uint)) allowed;

	event Approval(address indexed owner, address indexed spender, uint amount);
	event Transfer(address indexed from, address indexed to, uint amount);

	address public supplyController;
	address public immutable PREV_TOKEN;

	constructor(address supplyControllerAddr, address prevTokenAddr) {
		supplyController = supplyControllerAddr;
		PREV_TOKEN = prevTokenAddr;
	}

	function balanceOf(address owner) external view returns (uint balance) {
		return balances[owner];
	}

	function transfer(address to, uint amount) external returns (bool success) {
		balances[msg.sender] = balances[msg.sender] - amount;
		balances[to] = balances[to] + amount;
		emit Transfer(msg.sender, to, amount);
		return true;
	}

	function transferFrom(address from, address to, uint amount) external returns (bool success) {
		balances[from] = balances[from] - amount;
		allowed[from][msg.sender] = allowed[from][msg.sender] - amount;
		balances[to] = balances[to] + amount;
		emit Transfer(from, to, amount);
		return true;
	}

	function approve(address spender, uint amount) external returns (bool success) {
		allowed[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return true;
	}

	function allowance(address owner, address spender) external view returns (uint remaining) {
		return allowed[owner][spender];
	}

	// Supply control
	function innerMint(address owner, uint amount) internal {
		totalSupply = totalSupply + amount;
		balances[owner] = balances[owner] + amount;
		// Because of https://github.com/ethereum/EIPs/blob/master/EIPS/eip-20.md#transfer-1
		emit Transfer(address(0), owner, amount);
	}

	function mint(address owner, uint amount) external {
		require(msg.sender == supplyController, 'NOT_SUPPLYCONTROLLER');
		innerMint(owner, amount);
	}

	function changeSupplyController(address newSupplyController) external {
		require(msg.sender == supplyController, 'NOT_SUPPLYCONTROLLER');
		supplyController = newSupplyController;
	}

	// Swapping: multiplier is 10**(18-4)
	// NOTE: Burning by sending to 0x00 is not possible with many ERC20 implementations, but this one is made specifically for the old ADX
	uint constant PREV_TO_CURRENT_TOKEN_MULTIPLIER = 100000000000000;
	function swap(uint prevTokenAmount) external {
		innerMint(msg.sender, prevTokenAmount * PREV_TO_CURRENT_TOKEN_MULTIPLIER);
		SafeERC20.transferFrom(PREV_TOKEN, msg.sender, address(0), prevTokenAmount);
	}
}
