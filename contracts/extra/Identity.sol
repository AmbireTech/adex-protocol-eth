pragma solidity ^0.4.25;
pragma experimental ABIEncoderV2;

import "../libs/SafeMath.sol";
import "../libs/SafeERC20.sol";
import "../libs/SignatureValidator.sol";

contract Identity {
	using SafeMath for uint;

	// The next allowed nonce
	uint public nonce = 0;
	mapping (address => uint8) public privileges;
	mapping (address => mapping (address => uint)) feeEarnings;

	enum PrivilegeLevel {
		None,
		Predefines,
		Transactions,
		Withdraw
	}

	// Events

	// Transaction structure
	// @TODO read other implementations of metatx
	struct Transaction {
		uint nonce;
		address to;
		bytes data;
		// @TODO should we have an amount?
		address feeTokenAddr;
		uint feeTokenAmount;
		bytes32[3] signature;
	}

	constructor(address _addr, uint8 _priv) public {
		privileges[_addr] = _priv;
	}

	function execute(Transaction[] memory transactions) public {
		for (uint i=0; i<transactions.length; i++) {
			// setPrivilege: .Transactions
			// default (normal tx): .Transactions
		}
	}

	/*
	   flawed cause those tokens are not locked up
	function withdraw(address tokenAddr) {
		uint toWithdraw = feeEarnings[msg.sender][tokenAddr];
		feeEarnings[msg.sender][tokenAddr] = 0;
		SafeERC20.transfer(tokenAddr, msg.sender, toWithdraw);
	}*/

	// 1 privilege: withdraw (but check privilege of withdraw to addr), withdraw from channel, withdraw expired 
	// 2 privilege: setAddrPrivilege (where invoke with 0 means delete)
	// 3 privilege: serves to ensure address is withdrawalable to

	// @TODO things that need high privilege: setPrivilege
	// @TODO should channels withdraw directly to the withdrawal addr or to the identity?
	// @TODO: low privilege things/predefines
	// @TODO transaction scheduling
	// @TODO think of gas costs, how to optimize fee payments; we can do it by requiring the same fee token to be used on one execute()
}
