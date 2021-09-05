// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.1;

import "./libs/SafeERC20.sol";
import "./libs/SignatureValidatorV2.sol";

contract Identity {
	mapping (address => bool) public privileges;
	// The next allowed nonce
	uint public nonce = 0;

	// Events
	event LogPrivilegeChanged(address indexed addr, bool priv);

	// Transaction structure
	// we handle replay protection separately by requiring (address(this), chainID, nonce) as part of the sig
	struct Transaction {
		address to;
		uint value;
		bytes data;
	}

	constructor(address[] memory addrs) {
		uint len = addrs.length;
		for (uint i=0; i<len; i++) {
			privileges[addrs[i]] = true;
			emit LogPrivilegeChanged(addrs[i], true);
		}
	}

	// This contract can accept ETH without calldata
	receive() external payable {}

	// This contract can accept ETH with calldata
	fallback() external payable {}

	function setAddrPrivilege(address addr, bool priv)
		external
	{
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		privileges[addr] = priv;
		emit LogPrivilegeChanged(addr, priv);
	}

	// @TODO: should this stay? is this the right place for it?
	function tipMiner(uint amount)
		external
	{
		require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');
		// See https://docs.flashbots.net/flashbots-auction/searchers/advanced/coinbase-payment/#managing-payments-to-coinbaseaddress-when-it-is-a-contract
		// generally this contract is reentrancy proof cause of the nonce
		executeCall(block.coinbase, amount, new bytes(0));
	}

	function execute(Transaction[] calldata txns, bytes calldata signature)
		external
	{
		require(txns.length > 0, 'MUST_PASS_TX');
		// If we use the naive abi.encode(txn) and have a field of type `bytes`,
		// there is a discrepancy between ethereumjs-abi and solidity
		// @TODO check if this is resolved1
		uint currentNonce = nonce;
		bytes32 hash = keccak256(abi.encode(address(this), block.chainid, currentNonce, txns));
		// We have to increment before execution cause it protects from reentrancies
		nonce = currentNonce + 1;

		address signer = SignatureValidator.recoverAddr(hash, signature);
		require(privileges[signer], 'INSUFFICIENT_PRIVILEGE_TRANSACTION');
		uint len = txns.length;
		for (uint i=0; i<len; i++) {
			Transaction memory txn = txns[i];
			executeCall(txn.to, txn.value, txn.data);
		}
		// The actual anti-bricking mechanism - do not allow a signer to drop his own priviledges
		require(privileges[signer] == true, 'PRIVILEGE_NOT_DOWNGRADED');
	}

	// we shouldn't use address.call(), cause: https://github.com/ethereum/solidity/issues/2884
	// copied from https://github.com/uport-project/uport-identity/blob/develop/contracts/Proxy.sol
	// there's also
	// https://github.com/gnosis/MultiSigWallet/commit/e1b25e8632ca28e9e9e09c81bd20bf33fdb405ce
	// https://github.com/austintgriffith/bouncer-proxy/blob/master/BouncerProxy/BouncerProxy.sol
	// https://github.com/gnosis/safe-contracts/blob/7e2eeb3328bb2ae85c36bc11ea6afc14baeb663c/contracts/base/Executor.sol
	function executeCall(address to, uint256 value, bytes memory data)
		internal
	{
		assembly {
			let result := call(gas(), to, value, add(data, 0x20), mload(data), 0, 0)

			switch result case 0 {
				let size := returndatasize()
				let ptr := mload(0x40)
				returndatacopy(ptr, 0, size)
				revert(ptr, size)
			}
			default {}
		}
	}

	// EIP 1271 implementation
	// see https://eips.ethereum.org/EIPS/eip-1271
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
		if (privileges[SignatureValidator.recoverAddr(hash, signature)]) {
			// bytes4(keccak256("isValidSignature(bytes32,bytes)")
			return 0x1626ba7e;
		} else {
			return 0xffffffff;
		}
	}
}
