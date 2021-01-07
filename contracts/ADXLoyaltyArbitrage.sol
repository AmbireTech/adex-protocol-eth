pragma solidity ^0.8.0;

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * By default, the owner account will be the one that deploys the contract. This
 * can later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
contract Ownable {
    address private _owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the deployer as the initial owner.
     */
    constructor () {
        address msgSender = msg.sender;
        _owner = msgSender;
        emit OwnershipTransferred(address(0), msgSender);
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        require(_owner == msg.sender, "Ownable: caller is not the owner");
        _;
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions anymore. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby removing any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        emit OwnershipTransferred(_owner, address(0));
        _owner = address(0);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        require(newOwner != address(0), "Ownable: new owner is the zero address");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
}


interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

interface ILoyaltyPool {
	function enter(uint256 amount) external;
	function leave(uint256 shares) external;
}

interface ISimpleUniswap {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}


contract ADXLoyaltyArb is Ownable {
	ISimpleUniswap public constant uniswap = ISimpleUniswap(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
	IERC20 public constant ADX = IERC20(0xADE00C28244d5CE17D72E40330B1c318cD12B7c3);
	IERC20 public constant ADXL = IERC20(0xd9A4cB9dc9296e111c66dFACAb8Be034EE2E1c2C);

	constructor() {
		ADX.approve(address(uniswap), type(uint256).max);
		ADX.approve(address(ADXL), type(uint256).max);
		ADXL.approve(address(uniswap), type(uint256).max);
		ADXL.approve(address(ADXL), type(uint256).max);
	}

	// No need to check success here, no safeerc20
	function withdrawTokens(IERC20 token, uint amount) onlyOwner external {
		token.transfer(msg.sender, amount);
	}

	function tradeOnUni(address input, address output, uint amount) internal {
		address[] memory path = new address[](3);
		path[0] = input;
		// WETH
		path[1] = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
		path[2] = output;
		uniswap.swapExactTokensForTokens(amount, uint(0), path, address(this), block.timestamp);
	}

	function loyaltyTradesHigher(uint amountToSell) external {
		require(ADX.balanceOf(address(this)) == 0, 'must not have adx');
		uint initial = ADXL.balanceOf(address(this));
		// sell adx-loyalty on uniswap
		tradeOnUni(address(ADXL), address(ADX), amountToSell);
		// mint adx-loyalty with the ADX (profit adx-loyalty)
		ILoyaltyPool(address(ADXL)).enter(ADX.balanceOf(address(this)));
		// safety check
		require(ADXL.balanceOf(address(this)) > initial, 'did not make profit');
	}

	function loyaltyTradesLower(uint amountToBurn) external {
		require(ADX.balanceOf(address(this)) == 0, 'must not have adx');
		uint initial = ADXL.balanceOf(address(this));
		// burn adx-loyalty to receive adx
		ILoyaltyPool(address(ADXL)).leave(amountToBurn);
		// buy adx-loyalty with adx (profit adx-loyalty)
		tradeOnUni(address(ADX), address(ADXL), ADX.balanceOf(address(this)));
		// safety check
		require(ADXL.balanceOf(address(this)) > initial, 'did not make profit');
	}
}
