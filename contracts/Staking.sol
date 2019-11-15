pragma solidity ^0.5.6;
pragma experimental ABIEncoderV2;

import "./libs/SafeMath.sol";
import "./libs/SafeERC20.sol";

library BondLibrary {
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

	uint constant MAX_SLASH = 10 ** 18;
	uint constant TIME_TO_UNBOND = 30 days;

	address public tokenAddr;
	address public slasherAddr;
	// Addressed by bucketId
	mapping (bytes32 => uint) public totalFunds;
	mapping (bytes32 => uint) public slashPoints;
	// Addressed by bondId
	mapping (bytes32 => bool) public bondIsActive;
	mapping (bytes32 => uint) public bondSlashedAtOpen;
	mapping (bytes32 => uint) public bondWillUnlock;

	constructor(address slasher, address token) public {
   		tokenAddr = token;
   		slasherAddr = slasher;
	}

	function slash(bytes32 bucketId, uint pts) external {
		require(msg.sender == slasherAddr);
		require(pts + slashPoints[bucketId] <= MAX_SLASH);
		uint amount = pts
			.mul(totalFunds[bucketId])
			.div(MAX_SLASH.sub(slashPoints[bucketId]));
		slashPoints[bucketId] = slashPoints[bucketId].add(pts);
		totalFunds[bucketId] = totalFunds[bucketId].sub(amount);
		SafeERC20.transfer(tokenAddr, address(0x00), amount);
	}

	function addBond(BondLibrary.Bond memory bond) public {
		bytes32 id = bond.hash(msg.sender);
		require(!bondIsActive[id]);
		bondIsActive[id] = true;
		bondSlashedAtOpen[id] = slashPoints[bond.bucketId];
		totalFunds[bond.bucketId] = totalFunds[bond.bucketId].add(bond.amount);
		SafeERC20.transferFrom(tokenAddr, msg.sender, address(this), bond.amount);
	}

	function requestUnbond(BondLibrary.Bond memory bond) public {
		bytes32 id = bond.hash(msg.sender);
		require(bondIsActive[id]);
		bondWillUnlock[id] = now + TIME_TO_UNBOND;
	}

	function unbond(BondLibrary.Bond memory bond) public {
		bytes32 id = bond.hash(msg.sender);
		// redundant
		// require(bondIsActive[id]);
		require(bondWillUnlock[id] > 0 && now > bondWillUnlock[id]);
		uint amount = getWithdrawAmount(bond);
		bondIsActive[id] = false;
		bondWillUnlock[id] = 0;
		if (bondSlashedAtOpen[id] > 0) {
			bondSlashedAtOpen[id] = 0;
		}
		totalFunds[bond.bucketId] = totalFunds[bond.bucketId].sub(amount);
		SafeERC20.transfer(tokenAddr, msg.sender, amount);
	}

	function getWithdrawAmount(BondLibrary.Bond memory bond) public view returns (uint) {
		// TODO fix this .hash() perhaps
		// return (MAX_SLASH - slashPoints[bond.bucketId]) / (MAX_SLASH - bondSlashedAtOpen[bond.hash(msg.sender)]) * bond.amount
		return (MAX_SLASH.sub(slashPoints[bond.bucketId]))
			.mul(bond.amount)
			.div(MAX_SLASH.sub(bondSlashedAtOpen[bond.hash(msg.sender)]));
	}
}
