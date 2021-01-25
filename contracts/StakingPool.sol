// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "./interfaces/IADXToken.sol";

interface IChainlink {
	function latestAnswer() external view returns (uint);
}

// Full interface here: https://github.com/Uniswap/uniswap-v2-periphery/blob/master/contracts/interfaces/IUniswapV2Router01.sol
interface IUniswapSimple {
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract StakingPool {
	// ERC20 stuff
	// Constants
	string public constant name = "AdEx Staking Token";
	uint8 public constant decimals = 18;
	string public symbol = "ADX-STAKING";

	// @TODO: make this mutable?
	uint constant TIME_TO_UNBOND = 20 days;

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

	// ERC20 methods
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
	// How much ADX unlocks at a given time for each user
	mapping (address => mapping(uint => uint)) unlocksAt;

	// @TODO diret ref to supplyController
	// @TODO set in constructor?
	IUniswapSimple public constant uniswap = IUniswapSimple(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
	IChainlink public constant ADXUSDOracle = IChainlink(0x231e764B44b2C1b7Ca171fa8021A24ed520Cde10);

	IADXToken public ADXToken;
	mapping (address => bool) public governance;
	address public guardian;
	address public validator;
	uint public pendingToUnlock;

	// Staking pool events
	event LogLeave(address indexed owner, uint unlockAt, uint amount);
	event LogSetGovernance(address indexed addr, bool hasGovt, uint time);

	// @TODO proper args here
	constructor(IADXToken token, address _guardian, address _validator) {
		ADXToken = token;
		guardian = _guardian;
		validator = _validator;
		governance[msg.sender] = true;
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
	}

	// Governance functions
	// @TODO: consider a single owner rather than multiple govt?
	function setGovernance(address addr, bool hasGovt) external {
		require(governance[msg.sender], 'NOT_GOVERNANCE');
		governance[addr] = hasGovt;
		emit LogSetGovernance(addr, hasGovt, block.timestamp);
	}

	// Pool stuff
	function shareValue() external view returns (uint) {
		if (totalSupply == 0) return 0;
		return (ADXToken.balanceOf(address(this)) - pendingToUnlock + ADXToken.supplyController().mintableIncentive(address(this)))
			* 1e18
			/ totalSupply;
	}

	function enter(uint256 amount) external {
		// Please note that minting has to be in the beginning so that we take it into account
		// when using ADXToken.balanceOf()
		// Minting makes an external call but it's to a trusted contract (ADXToken)
		ADXToken.supplyController().mintIncentive(address(this));

		uint totalADX = ADXToken.balanceOf(address(this)) - pendingToUnlock;

		// The totalADX == 0 check here should be redudnant; the only way to get totalSupply to a nonzero val is by adding ADX
		if (totalSupply == 0 || totalADX == 0) {
			innerMint(msg.sender, amount);
		} else {
			uint256 newShares = amount * totalSupply / totalADX;
			innerMint(msg.sender, newShares);
		}
		require(ADXToken.transferFrom(msg.sender, address(this), amount));
		// @TODO event? note that innerMint/innerBurn have events
	}

	// @TODO: rename to stake/unskake?
	function leave(uint shares, bool skipMint) external {
		if (!skipMint) ADXToken.supplyController().mintIncentive(address(this));
		uint totalADX = ADXToken.balanceOf(address(this)) - pendingToUnlock;
		uint adxAmount = shares * totalADX / totalSupply;
		uint willUnlockAt = block.timestamp + TIME_TO_UNBOND;
		// Note: we burn their shares but don't give them the ADX immediately
		// since they no longer hold these shares, they won't occur ADX incentives (which are fixed per second)
		innerBurn(msg.sender, shares);
		unlocksAt[msg.sender][willUnlockAt] += adxAmount;
		pendingToUnlock += adxAmount;

		emit LogLeave(msg.sender, willUnlockAt, adxAmount);
		// @TODO note that innerMint/innerBurn have events
	}

	function withdraw(uint willUnlockAt) external {
		require(block.timestamp > willUnlockAt, 'UNLOCK_TOO_EARLY');
		uint adxAmount = unlocksAt[msg.sender][willUnlockAt];
		require(adxAmount > 0, 'ZERO_AMOUNT');
		unlocksAt[msg.sender][willUnlockAt] = 0;
		pendingToUnlock -= adxAmount;
		require(ADXToken.transfer(msg.sender, adxAmount));
		// @TODO event
	}

	function rageLeave(uint shares, bool skipMint) external {
		if (!skipMint) ADXToken.supplyController().mintIncentive(address(this));
		uint totalADX = ADXToken.balanceOf(address(this)) - pendingToUnlock;
		uint adxAmount = shares * totalADX / totalSupply;
		innerBurn(msg.sender, shares);
		// @TODO flexible penalty ratio
		require(ADXToken.transfer(msg.sender, adxAmount * 8 / 10));
		// @TODO: event; note that innerMint/innerBurn have events
	}

	// insurance
	function claim(address tokenOut, address to, uint amount) external {
		require(msg.sender == guardian, 'NOT_GUARDIAN');

		// @TODO we should call mintIncentive before that?
		uint totalADX = ADXToken.balanceOf(address(this)) - pendingToUnlock;

		// Note: whitelist of out tokens
		//require(isWhitelistedOutToken(tokenOut), 'token not whitelisted')
		// @TODO proper whitelist
		require(tokenOut == address(0xdAC17F958D2ee523a2206206994597C13D831ec7), 'TOKEN_NOT_WHITELISTED');

		address[] memory path = new address[](3);
		path[0] = address(ADXToken);
		path[1] = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // WETH; // @TODO should we call the uniswap router? research whether this can change
		path[2] = tokenOut;

		// You may think the uinswap call enables reentrancy, but reentrancy is a problem only if the pattern is check-call-modify, not call-check-modify as is here
		// there's no case in which we 'double-spend' a value
		// Plus, ADX, USDT and uniswap are all trusted

		// Slippage protection; 5% slippage allowed
		// @TODO make that dynamic
		uint price = ADXUSDOracle.latestAnswer();
		// amount is in 1e6, price is in 1e8
		// @TODO this changes with more stablecoins, so we have to keep a registry of their multipliers
		// We need to convert from 1e6 to 1e18 but we divide by 1e8; 18 - 6 + 8 ; verified this by calculating separately
		uint adxAmountMax = amount * 1.05e20 / price;
		require(adxAmountMax > totalADX, 'INSUFFICIENT_ADX');
		uint[] memory amounts = uniswap.swapTokensForExactTokens(amount, adxAmountMax, path, to, block.timestamp);

		// calculate the total ADX amount used in the swap
		uint adxAmountNeeded = amounts[0];

		// burn the validator shares so that they pay for it first, before dilluting other holders
		// calculate the worth in ADX of the validator's shares
		uint sharesNeeded = adxAmountNeeded * totalSupply / totalADX;
		innerBurn(validator, sharesNeeded < balances[validator] ? sharesNeeded : balances[validator]);
		// @TODO: event? keep in mind innerBurn generates an even
	}
}
