// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.6.12;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";

contract ADXFlashLoans {
	// Very important that this contract does not have any storage
	function flash(GeneralERC20 token, uint amount, address to, bytes memory data) public {
		uint bal = token.balanceOf(address(this));
		token.transfer(to, amount);
		assembly {
			let result := delegatecall(gas(), to, add(data, 0x20), mload(data), 0, 0)
			switch result case 0 {
				let size := returndatasize()
				let ptr := mload(0x40)
				returndatacopy(ptr, 0, size)
				revert(ptr, size)
			}
			default {}
		}
		require(token.balanceOf(address(this)) == bal, 'FLASHLOAN_NOT_RETURNED');
	}
}

contract ADXSupplyController {
	enum GovernanceLevel { None, Mint, All }
	mapping (address => uint8) governance;
	constructor() public {
		governance[msg.sender] = uint8(GovernanceLevel.All);
	}

	function mint(ADXToken token, address owner, uint amount) public {
		require(governance[msg.sender] >= uint8(GovernanceLevel.Mint), 'NOT_GOVERNANCE');
		// 150M * 10**18
		require(SafeMath.add(token.totalSupply(), amount) <= 150000000000000000000000000, 'MINT_TOO_LARGE');
		// 10 August 2020
		require(now > 1597017600, 'MINT_TOO_EARLY');
		token.mint(owner, amount);
	}

	function upgradeSupplyController(ADXToken token, address newSupplyController) public {
		require(governance[msg.sender] >= uint8(GovernanceLevel.All), 'NOT_GOVERNANCE');
		token.upgradeSupplyController(newSupplyController);
	}

	function setGovernance(address addr, uint8 level) public {
		require(governance[msg.sender] >= uint8(GovernanceLevel.All), 'NOT_GOVERNANCE');
		governance[addr] = level;
	}
}

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

	address public supplyController;
	address public immutable PREV_TOKEN;

	constructor(address supplyControllerAddr, address prevTokenAddr) public {
		supplyController = supplyControllerAddr;
		PREV_TOKEN = prevTokenAddr;
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
		require(msg.sender == supplyController, 'NOT_SUPPLYCONTROLLER');
		innerMint(owner, amount);
	}

	function upgradeSupplyController(address newSupplyController) public {
		require(msg.sender == supplyController, 'NOT_SUPPLYCONTROLLER');
		supplyController = newSupplyController;
	}

	// Swapping: multiplier is 10**(18-4)
	uint constant PREV_TO_CURRENT_TOKEN_MULTIPLIER = 100000000000000;
	function swap(uint prevTokenAmount) public {
		innerMint(msg.sender, prevTokenAmount.mul(PREV_TO_CURRENT_TOKEN_MULTIPLIER));
		SafeERC20.transferFrom(PREV_TOKEN, msg.sender, address(0), prevTokenAmount);
	}
}
