// @TODO: should we use a newer solidity?
pragma solidity ^0.5.13;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";

/*
contract ADXSupplyController {
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

	// Constants
	string public constant symbol = "ADX";
	string public constant name = "AdEx Network";
	uint8 public constant decimals = 18;

	// Mutable variables
	uint public totalSupply;
	mapping(address => uint) balances;
	mapping(address => mapping(address => uint)) allowed;

	event Approval(address indexed owner, address indexed spender, uint amount);
	event Transfer(address indexed from, address indexed to, uint amount);

	address public supplyController = address(0);
	address public prevToken = address(0);
	constructor(address supplyControllerAddr, address prevTokenAddr) public {
		supplyController = supplyControllerAddr;
		prevToken = prevTokenAddr;
	}

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

	// Flash loans: max 50 mil
	// @TODO can we use .call here? should it be delegatecall?
	uint constant public MAX_FLASH = 50000000000000000000000000;
	function flash(uint amount, address to, bytes memory data) public {
		require(amount <= MAX_FLASH, 'MAX_FLASH_EXCEEDED');
		balances[msg.sender] = balances[msg.sender].add(amount);
		to.call(data);
		balances[msg.sender] = balances[msg.sender].sub(amount);
	}

	// Supply control
	function mint(address owner, uint amount) public {
		require(msg.sender == supplyController);
		totalSupply = totalSupply.add(amount);
		balances[owner] = balances[owner].add(amount);
		// Because of https://github.com/ethereum/EIPs/blob/master/EIPS/eip-20.md#transfer-1
		emit Transfer(address(0), owner, amount);
	}

	function upgradeSupplyController(address newSupplyController) public {
		require(msg.sender == supplyController);
		supplyController = newSupplyController;
	}

	// Swapping: multiplier is 10**(18-4)
	uint constant PREV_TO_CURRENT_TOKEN_MULTIPLIER = 100000000000000;
	function swap(uint prevTokenAmount) public {
		uint amount = prevTokenAmount.mul(PREV_TO_CURRENT_TOKEN_MULTIPLIER);
		totalSupply = totalSupply.add(amount);
		balances[msg.sender] = balances[msg.sender].add(amount);
		// @TODO consider whether we should use the same burn addr sa staking
		SafeERC20.transferFrom(prevToken, msg.sender, address(0xaDbeEF0000000000000000000000000000000000), prevTokenAmount);
	}
}
