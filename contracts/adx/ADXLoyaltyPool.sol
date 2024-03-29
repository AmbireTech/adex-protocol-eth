// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.7;

import "../interfaces/IADXToken.sol";

contract ADXLoyaltyPoolToken {
	// ERC20 stuff
	// Constants
	string public constant name = "AdEx Loyalty";
	uint8 public constant decimals = 18;
	string public symbol = "ADX-LOYALTY";

	// Mutable variables
	uint public totalSupply;
	mapping(address => uint) balances;
	mapping(address => mapping(address => uint)) allowed;

	// EIP 2612
	bytes32 public DOMAIN_SEPARATOR;
	// keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
	bytes32 public constant PERMIT_TYPEHASH = 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9;
	mapping(address => uint) public nonces;

	// ERC20 events
	event Approval(address indexed owner, address indexed spender, uint amount);
	event Transfer(address indexed from, address indexed to, uint amount);

	function balanceOf(address owner) external view returns (uint balance) {
		return balances[owner];
	}

	function transfer(address to, uint amount) external returns (bool success) {
		require(to != address(this), 'BAD_ADDRESS');
		balances[msg.sender] = balances[msg.sender] - amount;
		balances[to] = balances[to] + amount;
		emit Transfer(msg.sender, to, amount);
		return true;
	}

	function transferFrom(address from, address to, uint amount) external returns (bool success) {
		balances[from] = balances[from] - amount;
		allowed[from][msg.sender] = allowed[from][msg.sender] - amount;
		balances[to] = balances[to] + amount;
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

	// EIP 2612
	function permit(address owner, address spender, uint amount, uint deadline, uint8 v, bytes32 r, bytes32 s) external {
		require(deadline >= block.timestamp, 'DEADLINE_EXPIRED');
		bytes32 digest = keccak256(abi.encodePacked(
			'\x19\x01',
			DOMAIN_SEPARATOR,
			keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, amount, nonces[owner]++, deadline))
		));
		address recoveredAddress = ecrecover(digest, v, r, s);
		require(recoveredAddress != address(0) && recoveredAddress == owner, 'INVALID_SIGNATURE');
		allowed[owner][spender] = amount;
		emit Approval(owner, spender, amount);
	}

	// Inner
	function innerMint(address owner, uint amount) internal {
		totalSupply = totalSupply + amount;
		balances[owner] = balances[owner] + amount;
		// Because of https://github.com/ethereum/EIPs/blob/master/EIPS/eip-20.md#transfer-1
		emit Transfer(address(0), owner, amount);
	}
	function innerBurn(address owner, uint amount) internal {
		totalSupply = totalSupply - amount;
		balances[owner] = balances[owner] - amount;
		emit Transfer(owner, address(0), amount);
	}


	// Pool functionality
	event LogSetGovernance(address indexed addr, bool hasGovt, uint time);
	event LogSetIncentive(uint incentive, uint time);

	IADXToken public ADXToken;
	uint public incentivePerTokenPerAnnum;
	uint public lastMintTime;
	uint public maxTotalADX;
	mapping (address => bool) public governance;
	constructor(IADXToken token, uint incentive, uint cap) {
		ADXToken = token;
		incentivePerTokenPerAnnum = incentive;
		maxTotalADX = cap;
		governance[msg.sender] = true;
		lastMintTime = block.timestamp;
		// EIP 2612
		uint chainId;
		assembly {
			chainId := chainid()
		}
		DOMAIN_SEPARATOR = keccak256(
			abi.encode(
				keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
				keccak256(bytes(name)),
				keccak256(bytes('1')),
				chainId,
				address(this)
			)
		);

		emit LogSetGovernance(msg.sender, true, block.timestamp);
		emit LogSetIncentive(incentive, block.timestamp);
	}

	// Governance functions
	function setGovernance(address addr, bool hasGovt) external {
		require(governance[msg.sender], 'NOT_GOVERNANCE');
		governance[addr] = hasGovt;
		emit LogSetGovernance(addr, hasGovt, block.timestamp);
	}
	// This doesn't trigger a mint because otherwise we risk of being unable to setIncentive to 0
	// if minting is impossible
	// It's the better tradeoff to make - and the issue of front-running mintIncnetive with setIncentive(0) can
	// be solved by timelocking the governance
	function setIncentive(uint newIncentive) external {
		require(governance[msg.sender], 'NOT_GOVERNANCE');
		incentivePerTokenPerAnnum = newIncentive;
		lastMintTime = block.timestamp;
		emit LogSetIncentive(newIncentive, block.timestamp);
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
			* totalADX
			* incentivePerTokenPerAnnum
			/ (365 days * 1e18);
	}

	function shareValue() external view returns (uint) {
		if (totalSupply == 0) return 0;
		return (ADXToken.balanceOf(address(this)) + this.toMint())
			* 1e18
			/ totalSupply;
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
		require(totalADX + amount <= maxTotalADX, 'REACHED_MAX_TOTAL_ADX');

		// The totalADX == 0 check here should be redudnant; the only way to get totalSupply to a nonzero val is by adding ADX
		if (totalSupply == 0 || totalADX == 0) {
			innerMint(msg.sender, amount);
		} else {
			uint256 newShares = (amount * totalSupply) / totalADX;
			innerMint(msg.sender, newShares);
		}
		require(ADXToken.transferFrom(msg.sender, address(this), amount));
	}

	function leaveInner(uint256 shares) internal {
		uint256 totalADX = ADXToken.balanceOf(address(this));
		uint256 adxAmount = (shares * totalADX) / totalSupply;
		innerBurn(msg.sender, shares);
		require(ADXToken.transfer(msg.sender, adxAmount));
	}

	function leave(uint256 shares) external {
		mintIncentive();
		leaveInner(shares);
	}

	// Guarantees ADX can be taken out even if minting is failing
	function emergencyLeave(uint256 shares) external {
		leaveInner(shares);
	}
}

interface IChainlinkSimple {
	function latestAnswer() external view returns (uint);
}

// NOTE: If this needs to be upgraded, we just deploy a new instance and remove the governance rights
// of the old instance and set rights for the new instance
contract ADXLoyaltyPoolIncentiveController {
	IChainlinkSimple public constant ADXUSDOracle = IChainlinkSimple(0x231e764B44b2C1b7Ca171fa8021A24ed520Cde10);
	ADXLoyaltyPoolToken public immutable loyaltyPool;
	constructor(ADXLoyaltyPoolToken lpt) {
		loyaltyPool = lpt;
	}

	function adjustIncentive() external {
		// Mint the current incurred incentive before changing the rate,
		// otherwise new rate would be applied for the entire period since the last mint
		loyaltyPool.mintIncentive();

		// At some point we might enable bonus periods:
		// if (block.timestamp < ...) { ... }
		// Or overinflation protection
		// if (loyaltyPool.ADXToken().totalSupply() > ...) { ... }

		// Reset the rate based on the price from the Chainlink oracle
		uint price = ADXUSDOracle.latestAnswer();
		require(price > 0, 'INVALID_ANSWER');
		if (price < 0.05*10**8) {
			loyaltyPool.setIncentive(uint(0.05*10**18));
		} else if (price < 0.10*10**8) {
			loyaltyPool.setIncentive(uint(0.10*10**18));
		} else if (price < 0.20*10**8) {
			loyaltyPool.setIncentive(uint(0.20*10**18));
		} else if (price < 0.35*10**8) {
			loyaltyPool.setIncentive(uint(0.25*10**18));
		} else if (price < 0.50*10**8) {
			loyaltyPool.setIncentive(uint(0.30*10**18));
		} else if (price < 1.00*10**8) {
			loyaltyPool.setIncentive(uint(0.35*10**18));
		} else if (price < 2.00*10**8) {
			loyaltyPool.setIncentive(uint(0.38*10**18));
		} else if (price < 2.50*10**8) {
			loyaltyPool.setIncentive(uint(0.40*10**18));
		} else {
			loyaltyPool.setIncentive(uint(0.45*10**18));
		}
	}
}
