// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "../libs/SafeMath.sol";

contract BadToken {
	mapping (address => uint) balances;

	function balanceOf(address owner) public view returns (uint) {
		return balances[owner];
	}

	// Breaks ERC20 spec: those 2 should return (bool)
	function transfer(address to, uint value) public {
		balances[msg.sender] = SafeMath.sub(balances[msg.sender], value);
		balances[to] = SafeMath.add(balances[to], value);
	}

	function transferFrom(address from, address to, uint value) public {
		balances[from] = SafeMath.sub(balances[from], value);
		balances[to] = SafeMath.add(balances[to], value);
	}

	function setBalanceTo(address to, uint value) public {
		balances[to] = value;
	}
}
