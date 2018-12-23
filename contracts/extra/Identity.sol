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

	constructor(address addr, uint8 priv) public {
		privileges[addr] = priv;
		// @TODO: deployer fees
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
			require(privileges[signer] >= uint8(PrivilegeLevel.Transactions), 'INSUFFICIENT_PRIVILEGE');

			nonce++;
			feeTokenAmount = feeTokenAmount.add(transaction.feeTokenAmount);
			// @TODO
		}
		if (feeTokenAmount > 0) {
			SafeERC20.transfer(feeTokenAddr, msg.sender, feeTokenAmount);
		}
	}

	function setAddrPrivilege(address addr, uint8 priv) external {
		require(msg.sender == address(this));
		privileges[addr] = priv;
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

	// privilege 1: withdraw (but check privilege of withdraw to addr), withdraw from channel, withdraw expired ,
	// @TODO low privilege things/predefines
	// @TODO transaction scheduling
}
