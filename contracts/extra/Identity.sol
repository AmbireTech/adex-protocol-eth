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
		address feeTokenAddr = transactions[0].feeTokenAddr;
		uint feeTokenAmount = 0;
		for (uint i=0; i<transactions.length; i++) {
			Transaction memory transaction = transactions[i];
			bytes32 hash = txHash(transaction);
			address signer = SignatureValidator.recoverAddr(hash, transaction.signature);

			require(transaction.feeTokenAddr == feeTokenAddr, 'EXECUTE_NEEDS_SINGLE_TOKEN');
			require(transaction.nonce == nonce, 'WRONG_NONCE');
			require(privileges[signer] >= uint8(PrivilegeLevel.Predefines), 'INSUFFICIENT_PRIVILEGE');

			nonce++;
			feeTokenAmount = feeTokenAmount.add(transaction.feeTokenAmount);
			// setPrivilege: .Transactions
			// default (normal tx): .Transactions
		}
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, msg.sender, feeTokenAmount);
		}
	}

	function txHash(Transaction memory transaction)
		internal
		view
		returns (bytes32)
	{
		return keccak256(abi.encode(
			address(this),
			transaction.nonce,
			transaction.to,
			transaction.data,
			transaction.feeTokenAddr,
			transaction.feeTokenAmount
		));
	}
	// 1 privilege: withdraw (but check privilege of withdraw to addr), withdraw from channel, withdraw expired 
	// 2 privilege: setAddrPrivilege (where invoke with 0 means delete)
	// 3 privilege: serves to ensure address is withdrawalable to

	// @TODO things that need high privilege: setPrivilege
	// @TODO should channels withdraw directly to the withdrawal addr or to the identity?
	// @TODO: low privilege things/predefines
	// @TODO transaction scheduling
	// @TODO think of gas costs, how to optimize fee payments; we can do it by requiring the same fee token to be used on one execute()
}
