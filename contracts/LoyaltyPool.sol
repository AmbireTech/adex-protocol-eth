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
	uint8 public constant decimals = 18;
	string public symbol = "ADX-LOYALTY";

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
		require(to != address(this), 'BAD_ADDRESS');
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
	uint public lastMintTime;
	uint public maxTotalADX;
	mapping (address => bool) public governance;
	constructor(IADXToken token, uint incentive, uint cap) public {
		ADXToken = token;
		incentivePerTokenPerAnnum = incentive;
		maxTotalADX = cap;
		governance[msg.sender] = true;
		lastMintTime = block.timestamp;
	}

	// Governance functions
	function setGovernance(address addr, bool hasGovt) external {
		require(governance[msg.sender], 'NOT_GOVERNANCE');
		governance[addr] = hasGovt;
	}
	function setIncentive(uint newIncentive) external {
		require(governance[msg.sender], 'NOT_GOVERNANCE');
		incentivePerTokenPerAnnum = newIncentive;
		lastMintTime = block.timestamp;
	}
	function setSymbol(string calldata newSymbol) external {
		require(governance[msg.sender], 'NOT_GOVERNANCE');
		symbol = newSymbol;
	}
	function setMaxTotalADX(uint newMaxTotalADX) external {
		require(governance[msg.sender], 'NOT_GOVERNANCE');
		maxTotalADX = newMaxTotalADX;
	}


	// Pool stuff
	// There are a few notable items in how minting works
	// 1) if ADX is sent to the LoyaltyPool in-between mints, it will calculate the incentive as if this amount
	// has been there the whole time since the last mint
	// 2) Compounding is happening when mint is called, so essentially when entities enter/leave/trigger it manually
	function toMint() external view returns (uint) {
		if (block.timestamp <= lastMintTime) return 0;
		uint totalADX = ADXToken.balanceOf(address(this));
		return (block.timestamp - lastMintTime)
			.mul(totalADX)
			.mul(incentivePerTokenPerAnnum)
			.div(365 days * 10e17);
	}
	function shareValue() external view returns (uint) {
		if (totalSupply == 0) return 0;
		return ADXToken.balanceOf(address(this))
			.add(this.toMint())
			.mul(10e17)
			.div(totalSupply);
	}

	function mintIncentive() public {
		if (incentivePerTokenPerAnnum == 0) return;
		uint amountToMint = this.toMint();
		if (amountToMint == 0) return;
		lastMintTime = block.timestamp;
		ADXToken.supplyController().mint(address(ADXToken), address(this), amountToMint);
	}

	function enter(uint256 amount) external {
		// Please note that minting has to be in the beginning so that we take it into account
		// when using ADXToken.balanceOf()
		// Minting makes an external call but it's to a trusted contract (ADXToken)
		mintIncentive();

		uint totalADX = ADXToken.balanceOf(address(this));
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

	function mintAndLeave(uint256 shares) external {
		mintIncentive();
		leave(shares);
	}
}

// @TODO check if chainlink contract can be upgraded/deprecated
interface IChainlinkSimple {
	function latestAnswer() external view returns (uint);
}
// @TODO: consider using uni getReserves
interface ERC20Simple {
	function balanceOf(address) external view returns (uint);
}

// NOTE: If this needs to be upgraded, we just deploy a new instance and remove the governance rights
// of the old instance and set rights for the new instance
contract LoyaltyPoolIncentiveController {
	using SafeMath for uint;

	IChainlinkSimple public ETHUSDOracle = IChainlinkSimple(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419);
	ERC20Simple public WETH = ERC20Simple(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
	address public uniPair = 0xD3772A963790feDE65646cFdae08734A17cd0f47;

	LoyaltyPoolToken public loyaltyPool;

	constructor(LoyaltyPoolToken lpt) public {
		loyaltyPool = lpt;
	}

	// @TODO explain why this is OK
	function latestPrice() external view returns (uint) {
		// NOTE: can also be implemented via uniswap getReserves
		return ETHUSDOracle.latestAnswer()
			.div(WETH.balanceOf(uniPair))
			.mul(loyaltyPool.ADXToken().balanceOf(uniPair));
	}

	function adjustIncentive() external {
		uint price = this.latestPrice();
		if (price < 0.05*10**8) {
			loyaltyPool.setIncentive(uint(0.10*10**18));
		} else if (price < 0.10*10**18) {
			loyaltyPool.setIncentive(uint(0.15*10**18));
		} else if (price < 0.20*10**18) {
			loyaltyPool.setIncentive(uint(0.25*10**18));
		} else if (price < 0.30*10**18) {
			loyaltyPool.setIncentive(uint(0.30*10**18));
		} else if (price < 0.50*10**18) {
			loyaltyPool.setIncentive(uint(0.35*10**18));
		} else if (price < 1.00*10**18) {
			loyaltyPool.setIncentive(uint(0.40*10**18));
		} else if (price < 2.00*10**18) {
			loyaltyPool.setIncentive(uint(0.45*10**18));
		} else {
			loyaltyPool.setIncentive(uint(0.50*10**18));
		}
	}
}
