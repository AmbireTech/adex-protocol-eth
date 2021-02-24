// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "./interfaces/IADXToken.sol";

interface IERCDecimals {
	function decimals() external view returns (uint);
}

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
	// @TODO: make this mutable?
	uint constant TIME_TO_UNBOND = 20 days;
	// @TODO maybe a direct reference to supplyController will save gas
	// @TODO set in constructor?
	IUniswapSimple public constant uniswap = IUniswapSimple(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
	IChainlink public constant ADXUSDOracle = IChainlink(0x231e764B44b2C1b7Ca171fa8021A24ed520Cde10);

	IADXToken public ADXToken;
	address public guardian;
	address public validator;

	// Commitment ID against the max amount of tokens it will pay out
	mapping (bytes32 => uint) public commitments;
	// How many of a user's shares are locked
	mapping (address => uint) public lockedShares;
	// Unbonding commitment from a staker
	struct UnbondCommitment {
		address owner;
		uint shares;
		uint unlocksAt;
	}

	// claims/penalizations limits
	uint public immutable MAX_DAILY_PENALTIES_PROMILLES;
	uint public limitLastReset;
	uint public limitRemaining;

	// Staking pool events
	// LogLeave/LogWithdraw must begin with the UnbondCommitment struct
	event LogLeave(address indexed owner, uint shares, uint unlockAt, uint maxTokens);
	event LogWithdraw(address indexed owner, uint shares, uint unlocksAt, uint maxTokens, uint receivedTokens);
	event LogRageLeave(address indexed owner, uint shares, uint maxTokens, uint receivedTokens);
	event LogClaim(address tokenAddr, address to, uint amountInUSD, uint burnedValidatorShares);
	event LogPenalize(uint burnedADX);

	constructor(IADXToken token, address guardianAddr, address validatorAddr, uint dailyPenalties) {
		ADXToken = token;
		guardian = guardianAddr;
		validator = validatorAddr;

		// max daily penalties
		require(dailyPenalties <= 500, 'DAILY_PENALTY_TOO_LARGE');
		MAX_DAILY_PENALTIES_PROMILLES = dailyPenalties;

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
	}

	// Pool stuff
	function shareValue() external view returns (uint) {
		if (totalSupply == 0) return 0;
		return (ADXToken.balanceOf(address(this)) + ADXToken.supplyController().mintableIncentive(address(this)))
			* 1e18
			/ totalSupply;
	}

	function innerEnter(address recipient, uint amount) internal {
		// Please note that minting has to be in the beginning so that we take it into account
		// when using ADXToken.balanceOf()
		// Minting makes an external call but it's to a trusted contract (ADXToken)
		ADXToken.supplyController().mintIncentive(address(this));

		uint totalADX = ADXToken.balanceOf(address(this));

		// The totalADX == 0 check here should be redudnant; the only way to get totalSupply to a nonzero val is by adding ADX
		if (totalSupply == 0 || totalADX == 0) {
			innerMint(recipient, amount);
		} else {
			uint256 newShares = amount * totalSupply / totalADX;
			innerMint(recipient, newShares);
		}
		require(ADXToken.transferFrom(msg.sender, address(this), amount));

		// no events, as innerMint already emits enough to know the shares amount and price
	}

	function enter(uint amount) external {
		innerEnter(msg.sender, amount);
	}

	function enterTo(address recipient, uint amount) external {
		innerEnter(recipient, amount);
	}

	function unbondingCommitmentWorth(address owner, uint shares, uint unlocksAt) external view returns (uint) {
		bytes32 commitmentId = keccak256(abi.encode(UnbondCommitment({ owner: owner, shares: shares, unlocksAt: unlocksAt })));
		uint maxTokens = commitments[commitmentId];
		uint totalADX = ADXToken.balanceOf(address(this));
		uint currentTokens = shares * totalADX / totalSupply;
		return currentTokens > maxTokens ? maxTokens : currentTokens;
	}

	function leave(uint shares, bool skipMint) external {
		if (!skipMint) ADXToken.supplyController().mintIncentive(address(this));

		require(shares <= balances[msg.sender] - lockedShares[msg.sender], 'INSUFFICIENT_SHARES');
		uint totalADX = ADXToken.balanceOf(address(this));
		uint maxTokens = shares * totalADX / totalSupply;
		uint unlocksAt = block.timestamp + TIME_TO_UNBOND;
		UnbondCommitment memory commitment = UnbondCommitment({ owner: msg.sender, shares: shares, unlocksAt: unlocksAt });
		bytes32 commitmentId = keccak256(abi.encode(commitment));
		require(commitments[commitmentId] == 0, 'COMMITMENT_EXISTS');

		commitments[commitmentId] = maxTokens;
		lockedShares[msg.sender] += shares;

		emit LogLeave(msg.sender, shares, unlocksAt, maxTokens);
	}

	function withdraw(uint shares, uint unlocksAt, bool skipMint) external {
		if (!skipMint) ADXToken.supplyController().mintIncentive(address(this));

		require(block.timestamp > unlocksAt, 'UNLOCK_TOO_EARLY');
		bytes32 commitmentId = keccak256(abi.encode(UnbondCommitment({ owner: msg.sender, shares: shares, unlocksAt: unlocksAt })));
		uint maxTokens = commitments[commitmentId];
		require(maxTokens > 0, 'NO_COMMITMENT');
		uint totalADX = ADXToken.balanceOf(address(this));
		uint currentTokens = shares * totalADX / totalSupply;
		uint receivedTokens = currentTokens > maxTokens ? maxTokens : currentTokens;

		commitments[commitmentId] = 0;
		lockedShares[msg.sender] -= shares;

		innerBurn(msg.sender, shares);
		require(ADXToken.transfer(msg.sender, receivedTokens));

		emit LogWithdraw(msg.sender, shares, unlocksAt, maxTokens, receivedTokens);
	}

	function rageLeave(uint shares, bool skipMint) external {
		if (!skipMint) ADXToken.supplyController().mintIncentive(address(this));
		uint totalADX = ADXToken.balanceOf(address(this));
		uint adxAmount = shares * totalADX / totalSupply;
		// @TODO mutable penalty ratio
		uint receivedTokens = adxAmount * 7 / 10;
		innerBurn(msg.sender, shares);
		require(ADXToken.transfer(msg.sender, receivedTokens));

		emit LogRageLeave(msg.sender, shares, adxAmount, receivedTokens);
	}

	// insurance
	function claim(address tokenOut, address to, uint amount) external {
		require(msg.sender == guardian, 'NOT_GUARDIAN');

		// NOTE: minting is intentionally skipped here
		// This means that a validator may be punished a bit more when burning their shares,
		// but it guarantees that claim() always works
		uint totalADX = ADXToken.balanceOf(address(this));

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
		uint price = ADXUSDOracle.latestAnswer();
		// chainlink price is in 1e8
		// for example, if the amount is in 1e6;
		// we need to convert from 1e6 to 1e18 (adx) but we divide by 1e8 (price); 18 - 6 + 8 ; verified this by calculating manually
		uint multiplier = 1.05e26 / (10 ** IERCDecimals(tokenOut).decimals());
		uint adxAmountMax = amount * multiplier / price;
		require(adxAmountMax > totalADX, 'INSUFFICIENT_ADX');
		uint[] memory amounts = uniswap.swapTokensForExactTokens(amount, adxAmountMax, path, to, block.timestamp);

		// calculate the total ADX amount used in the swap
		uint adxAmountUsed = amounts[0];

		// burn the validator shares so that they pay for it first, before dilluting other holders
		// calculate the worth in ADX of the validator's shares
		uint sharesNeeded = adxAmountUsed * totalSupply / totalADX;
		uint toBurn = sharesNeeded < balances[validator] ? sharesNeeded : balances[validator];
		if (toBurn > 0) innerBurn(validator, toBurn);

		// Technically redundant cause we'll fail on the subtraction, but we're doing this for better err msgs
		require(limitRemaining >= adxAmountUsed, 'LIMITS');
		limitRemaining -= adxAmountUsed;

		// @TODO: emit sharePrice here?
		emit LogClaim(tokenOut, to, amount, toBurn);
	}

	function penalize(uint adxAmount) external {
		require(msg.sender == guardian, 'NOT_GUARDIAN');
		// Technically redundant cause we'll fail on the subtraction, but we're doing this for better err msgs
		require(limitRemaining >= adxAmount, 'LIMITS');
		limitRemaining -= adxAmount;
		require(ADXToken.transfer(address(0), adxAmount));
		emit LogPenalize(adxAmount);
	}

	// anyone can call this
	function resetLimits() external {
		require(block.timestamp - limitLastReset > 24 hours, 'RESET_TOO_EARLY');
		limitLastReset = block.timestamp;
		limitRemaining = ADXToken.balanceOf(address(this)) * MAX_DAILY_PENALTIES_PROMILLES / 1000;
	}
}
