// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;

import "./libs/SafeMath.sol";

// @TODO: another name for that interface
interface ERC20 {
	function transfer(address to, uint256 amount) external returns (bool);
	function transferFrom(address from, address to, uint256 amount) external returns (bool);
	function approve(address spender, uint256 amount) external returns (bool);
	function balanceOf(address spender) external view returns (uint);
	function allowance(address owner, address spender) external view returns (uint);
	function supplyController() external view returns (address);
}

interface SupplyController {
	function mint(ERC20 token, address owner, uint amount) external;
}

contract LoyaltyPoolToken {
	using SafeMath for uint;

	// ERC20 stuff
	// Constants
	string public constant name = "AdEx Loyalty";
	string public constant symbol = "ADX-LOYALTY"; // @TODO?
	uint8 public constant decimals = 18;

	// Mutable variables
	uint public totalSupply;
	mapping(address => uint) balances;
	mapping(address => mapping(address => uint)) allowed;

	event Approval(address indexed owner, address indexed spender, uint amount);
	event Transfer(address indexed from, address indexed to, uint amount);

	function balanceOf(address owner) external view returns (uint balance) {
		return balances[owner];
	}

	function transfer(address to, uint amount) external returns (bool success) {
		balances[msg.sender] = balances[msg.sender].sub(amount);
		balances[to] = balances[to].add(amount);
		emit Transfer(msg.sender, to, amount);
		return true;
	}

	function transferFrom(address from, address to, uint amount) external returns (bool success) {
		balances[from] = balances[from].sub(amount);
		allowed[from][msg.sender] = allowed[from][msg.sender].sub(amount);
		balances[to] = balances[to].add(amount);
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

	function innerMint(address owner, uint amount) internal {
		totalSupply = totalSupply.add(amount);
		balances[owner] = balances[owner].add(amount);
		// Because of https://github.com/ethereum/EIPs/blob/master/EIPS/eip-20.md#transfer-1
		emit Transfer(address(0), owner, amount);
	}
	function innerBurn(address owner, uint amount) internal {
		totalSupply = totalSupply.sub(amount);
		balances[owner] = balances[owner].sub(amount);
		emit Transfer(owner, address(0), amount);
	}

	// Constructor
	ERC20 public ADXToken;
	constructor(ERC20 token) public {
		ADXToken = token;
	}

	// Pool stuff
	function totalADX() external view returns (uint) {
		return ADXToken.balanceOf(address(this));
	}

	function enter(uint256 amount) public {
		// @TODO var names
		uint256 totalTokens = this.totalADX();
		if (totalSupply == 0 || totalTokens == 0) {
			innerMint(msg.sender, amount);
		} else {
			uint256 newShares = amount.mul(totalSupply).div(totalTokens);
			innerMint(msg.sender, newShares);
		}
		ADXToken.transferFrom(msg.sender, address(this), amount);
	}

	function leave(uint256 shares) public {
		uint256 adxAmount = shares.mul(this.totalADX()).div(totalSupply);
		innerBurn(msg.sender, shares);
		ADXToken.transfer(msg.sender, adxAmount);
	}
}
