// @TODO: should we use a newer solidity?
pragma solidity ^0.5.13;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";

/*
contract SupplyController {
	address public constant prevToken = "0x4470BB87d77b963A013DB939BE332f927f2b992e";

	function mintFromPrevTokenBurn() public {
	
	}

	function mintBondFromBondBurn() {
		// @TODO: check if this staking contract is allowed
		// this presumes the token of the staking contract as well
	}
}
*/

contract ADXToken {
	using SafeMath for uint;

	string public constant symbol = "ADX";
	string public constant name = "AdEx Network";
	uint8 public constant decimals = 18;
	// @TODO dynamic
	address public supplyController = address(0x0000000000000000000000000000000000000000);

	// Variables
	uint public totalSupply;
	mapping(address => uint) balances;
	mapping(address => mapping(address => uint)) allowed;

	// @TODO order?
	event Approval(address indexed owner, address indexed spender, uint amount);
	event Transfer(address indexed from, address indexed to, uint amount);

	function balanceOf(address owner) public view returns (uint balance) {
		return balances[owner];
	}

	function transfer(address to, uint amount) public returns (bool success) {
		balances[msg.sender] = balances[msg.sender].sub(amount);
		balances[to] = balances[to].add(amount);
		emit Transfer(msg.sender, to, amount);
		return true;
	}

	function allowance(address owner, address spender) public view returns (uint remaining) {
		return allowed[owner][spender];
	}

	function approve(address spender, uint amount) public returns (bool success) {
		allowed[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return true;
	}

	function transferFrom(address from, address to, uint amount) public returns (bool success) {
		balances[from] = balances[from].sub(amount);
		allowed[from][msg.sender] = allowed[from][msg.sender].sub(amount);
		balances[to] = balances[to].add(amount);
		emit Transfer(from, to, amount);
		return true;
	}

	// Outside of ERC20
	// Supply control
	function mint(address owner, uint amount) public {
		require(msg.sender == supplyController);
		totalSupply = totalSupply.add(amount);
		balances[owner] = balances[owner].add(amount);
		// @TODO emit Transfer?
	}

	// should we allow this? prob not as people can mess with the supply
	function burn(uint amount) public {
		totalSupply = totalSupply.sub(amount);
		balances[msg.sender] = balances[msg.sender].sub(amount);
	}

	// Swapping
	// @TODO
}
