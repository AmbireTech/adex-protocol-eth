pragma solidity ^0.5.6;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";

library BondLibrary {
	uint constant TIME_TO_UNBOND = 30 days;
	struct Bond {
		uint amount;
		bytes32 bucketId;
	}

	function hash(Bond memory bond, address sender)
		internal
		view
		returns (bytes32)
	{
		return keccak256(abi.encode(
			address(this),
			sender,
			bond.amount,
			bond.bucketId
		));
	}
}

contract Staking {
	using SafeMath for uint;
	using BondLibrary for BondLibrary.Bond;

	address public tokenAddr;
	address public slasherAddr;
	mapping (bytes32 => uint) public totalFunds;
	mapping (bytes32 => uint) public slashPoints;
	mapping (bytes32 => bool) public bondIsActive;
	mapping (bytes32 => uint) public bondSlashedAtOpen;
	mapping (bytes32 => uint) public bondWillUnlock;

	constructor(address slasher, address token) public {
   		tokenAddr = token;
   		slasherAddr = slasher;
	}
}
