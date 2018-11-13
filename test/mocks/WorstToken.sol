pragma solidity ^0.4.25;

contract WorstToken {
	mapping (address => uint) balances;

	function balanceOf(address owner) public view returns (uint) {
		return balances[owner];
	}

	function transfer(address to, uint value) public returns (bool) {
		if (value > balances[msg.sender]) {
			return false;
		}
		balances[msg.sender] = balances[msg.sender] - value;
		balances[to] = balances[to] + value;
		return true;
	}

	function transferFrom(address from, address to, uint value) public returns (bool) {
		if (value > balances[from]) {
			return false;
		}
		balances[from] = balances[from] - value;
		balances[to] = balances[to] + value;
		return true;
	}

	function setBalanceTo(address to, uint value) public {
		balances[to] = value;
	}
}