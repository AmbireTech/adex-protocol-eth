pragma solidity ^0.5.2;

import "../../contracts/libs/SafeMath.sol";

contract Token {
	mapping (address => uint) balances;
	event Transfer(address indexed from, address indexed to, uint value);
	function balanceOf(address owner) public view returns (uint) {
		return balances[owner];
	}

	function transfer(address to, uint value) public returns (bool) {
		balances[msg.sender] = SafeMath.sub(balances[msg.sender], value);
		balances[to] = SafeMath.add(balances[to], value);
		emit Transfer(msg.sender, to, value);
		return true;
	}

	function transferFrom(address from, address to, uint value) public returns (bool) {
		balances[from] = SafeMath.sub(balances[from], value);
		balances[to] = SafeMath.add(balances[to], value);
		emit Transfer(from, to, value);
		return true;
	}

	function setBalanceTo(address to, uint value) public {
		balances[to] = value;
	}
}
