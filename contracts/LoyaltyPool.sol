// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;

import "./libs/SafeMath.sol";

interface ISupplyController {
	function mint(address token, address owner, uint amount) external;
}

interface IADXToken {
	function transfer(address to, uint256 amount) external returns (bool);
	function transferFrom(address from, address to, uint256 amount) external returns (bool);
	function approve(address spender, uint256 amount) external returns (bool);
	function balanceOf(address spender) external view returns (uint);
	function allowance(address owner, address spender) external view returns (uint);
	function supplyController() external view returns (ISupplyController);
}

contract LoyaltyPoolToken {
	using SafeMath for uint;

	// ERC20 stuff
	// Constants
	string public constant name = "AdEx Loyalty";
	string public constant symbol = "ADX-LOYALTY"; // @TODO changable?
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
	IADXToken public ADXToken;
	uint public incentivePerTokenPerAnnum;
	address public owner;
	uint public lastMintTime;
	// @TODO should this be fixed?
	uint public maxTotalADX;
	constructor(IADXToken token, uint incentive, uint cap) public {
		ADXToken = token;
		incentivePerTokenPerAnnum = incentive;
		maxTotalADX = cap;
		owner = msg.sender;
		lastMintTime = block.timestamp;
	}

	// Admin stuff
	// @TODO consider using err message format from normal AdEx contracts
	function setOwner(address newOwner) public {
		require(msg.sender == owner, 'NOT_OWNER');
		owner = newOwner;
	}
	function setIncentive(uint incentive) public {
		require(msg.sender == owner, 'NOT_OWNER');
		incentivePerTokenPerAnnum = incentive;
	}

	// Pool stuff
	function toMint() external view returns (uint) {
		return block.timestamp.sub(lastMintTime)
			.mul(ADXToken.balanceOf(address(this)))
			.mul(incentivePerTokenPerAnnum)
			.div(365 days);
	}

	function mintIncentive() internal {
		if (incentivePerTokenPerAnnum == 0) return;
		// @TODO warning if the tokens were received between enters/leaves, this calculation is off
		// @TODO compounding will be triggered when people withdraw/deposit
		// @TODO minting will set two storage slots (totalSupply, balance) so maybe it makes sense to defer it
		uint amountToMint = this.toMint();
		lastMintTime = block.timestamp;
		ADXToken.supplyController().mint(address(ADXToken), address(this), amountToMint);
	}

	function enter(uint256 amount) public {
		// @TODO explain why this is at the beginning and not the end
		mintIncentive();

		uint256 totalADX = ADXToken.balanceOf(address(this));
		require(totalADX < maxTotalADX, 'REACHED_MAX_TOTAL_ADX');

		if (totalSupply == 0 || totalADX == 0) {
			innerMint(msg.sender, amount);
		} else {
			uint256 newShares = amount.mul(totalSupply).div(totalADX);
			innerMint(msg.sender, newShares);
		}
		ADXToken.transferFrom(msg.sender, address(this), amount);
	}

	function leave(uint256 shares) public {
		uint256 totalADX = ADXToken.balanceOf(address(this));
		uint256 adxAmount = shares.mul(totalADX).div(totalSupply);
		innerBurn(msg.sender, shares);
		ADXToken.transfer(msg.sender, adxAmount);
	}

	function mintAndLeave(uint256 shares) public {
		mintIncentive();
		leave(shares);
	}
}
