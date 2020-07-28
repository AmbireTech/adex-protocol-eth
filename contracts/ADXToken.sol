// @TODO: should we use a newer solidity?
pragma solidity ^0.5.13;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";

/*contract ADXSupplyController {
	function mintBondFromBondBurn() public {
		// @TODO: check if this staking contract is allowed
		// this presumes the token of the staking contract as well
	}
}*/

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

	// Supply control
	function innerMint(address owner, uint amount) internal {
		totalSupply = totalSupply.add(amount);
		balances[owner] = balances[owner].add(amount);
		// Because of https://github.com/ethereum/EIPs/blob/master/EIPS/eip-20.md#transfer-1
		emit Transfer(address(0), owner, amount);
	}
	function mint(address owner, uint amount) public {
		require(msg.sender == supplyController);
		innerMint(owner, amount);
	}

	function upgradeSupplyController(address newSupplyController) public {
		require(msg.sender == supplyController);
		supplyController = newSupplyController;
	}

	// Swapping: multiplier is 10**(18-4)
	uint constant PREV_TO_CURRENT_TOKEN_MULTIPLIER = 100000000000000;
	function swap(uint prevTokenAmount) public {
		innerMint(msg.sender, prevTokenAmount.mul(PREV_TO_CURRENT_TOKEN_MULTIPLIER));
		SafeERC20.transferFrom(prevToken, msg.sender, address(0), prevTokenAmount);
	}
}
