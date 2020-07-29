pragma solidity ^0.6.12;

import "../../contracts/libs/SafeMath.sol";

contract Token {
	mapping (address => uint) balances;
	// The approvals are pretty much dummy; they're not used in transferFrom
	mapping (address => uint) approvals;
	event Transfer(address indexed from, address indexed to, uint value);
	function balanceOf(address owner) public view returns (uint) {
		return balances[owner];
	}
	function allowance(address, address spender) public view returns (uint) {
		return approvals[spender];
	}

	function transfer(address to, uint value) public returns (bool) {
		require(balances[msg.sender] >= value, 'INSUFFICIENT_FUNDS');
		balances[msg.sender] = SafeMath.sub(balances[msg.sender], value);
		balances[to] = SafeMath.add(balances[to], value);
		emit Transfer(msg.sender, to, value);
		return true;
	}

	function transferFrom(address from, address to, uint value) public returns (bool) {
		require(balances[from] >= value, 'INSUFFICIENT_FUNDS');
		balances[from] = SafeMath.sub(balances[from], value);
		balances[to] = SafeMath.add(balances[to], value);
		if (approvals[msg.sender] > 0) approvals[msg.sender] = 0;
		emit Transfer(from, to, value);
		return true;
	}
	function approve(address spender, uint value) public returns (bool) {
		approvals[spender] = value;
		return true;
	}
	function setBalanceTo(address to, uint value) public {
		balances[to] = value;
	}
}
