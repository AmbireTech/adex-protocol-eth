// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "./OUTPACE.sol";
import "./libs/SafeERC20.sol";

interface IStakingPool {
	function claim(address tokenOut, address to, uint amount) external;
}

contract Guardian {
	// variables
	address public owner;
	address public court;
	mapping (address => address) public poolForValidator;
	mapping (bytes32 => uint) public remaining;
	// channelId => spender => isRefunded
	mapping (bytes32 => mapping(address => bool)) refunds;
	uint public interestPromilles = 1100;
	OUTPACE outpace;

	constructor(OUTPACE _outpace) {
		owner = msg.sender;
		outpace = _outpace;
	}

	function setOwner(address newOwner) external {
		require(msg.sender == owner, 'not owner');
		owner = newOwner;
	}

	function setCourt(address newCourt) external {
		require(msg.sender == owner, 'not owner');
		court = newCourt;
	}

	function setInterest(uint newInterest) external {
		require(msg.sender == owner, 'not owner');
		require(newInterest > 1000 && newInterest < 2000, 'must be between 1 and 2');
		interestPromilles = newInterest;
	}

	function challenge(OUTPACE.Channel calldata channel) external {
		require(msg.sender == owner, 'not owner');
		outpace.challenge(channel);
	}

	function registerPool(address pool) external {
		require(poolForValidator[msg.sender] == address(0), 'staking pool already registered');
		poolForValidator[msg.sender] = pool;
	}

	function getBlame(OUTPACE.Channel memory channel) internal pure returns (address) {
		//if (court == address(0)) return channel.leader;
		//else ICourt(court).getBlame(channel);
		// @TODO court
		return channel.leader;
	}
	
	// @TODO: should we cache blame?
	function getRefund(OUTPACE.Channel calldata channel, address spender, uint spentAmount, bytes32[] calldata proof) external {
		require(channel.guardian == address(this), 'not guardian');
		bytes32 channelId = keccak256(abi.encode(channel));
		// ensure the channel is closed (fail if it can't be closed yet)
		// calculate blame, and how much funds we already got back from the channel, how much we should slash
		// ensure the passed in campaign has a real deposit
		// refund, optionally by slashing

		// code-wise, perhaps make a separate method that gets executed only once that updates all the refund state (for a channel) initially to calculate who's to blame and save what's taken already; perhaps it would be best to liquidate the adx at once now

		require(!refunds[channelId][spender], 'refund already received');
		refunds[channelId][spender] = true;

		uint totalDeposited = outpace.deposits(channelId, spender);
		uint remainingFunds = remaining[channelId];

		bytes32 lastStateRoot = outpace.lastStateRoot(channelId);
		// if lastStateRoot is 0, spentAmount can also be 0 without verification
		if (!(spentAmount == 0 && lastStateRoot == bytes32(0))) {
			bytes32 balanceLeaf = keccak256(abi.encode('spender', spender, spentAmount));
			require(MerkleProof.isContained(balanceLeaf, proof, lastStateRoot), 'balance leaf not found');
		}
		// @TODO consider not applying the interest multiplier if there is no lastStateRoot
		// cause without it, some might open non-legit channels with real validators, let them expire and try to claim the interest
		uint refundableDeposit = totalDeposited-spentAmount;
		// @TODO: also do not apply interest when there is no pool to blame
		if (lastStateRoot != bytes32(0)) {
			refundableDeposit = refundableDeposit * interestPromilles / 1000;
		}

		if (outpace.challenges(channelId) != type(uint256).max) {
			//require(remaining == 0) // make sure our internal state makes sense
			// @TODO also require that some additional time is passed (eg 1 week)
			// this would make sure that people have time to withdraw their funds
			//require(outpace.canBeClosed())

			remainingFunds = outpace.remaining(channelId);
			outpace.close(channel);
			// assign blame now
			//blame[channel] = validator // call court if available
		}

		if (remainingFunds == 0) {
			// Optimizing the case in which remaining has ran out - then we just claim directly to the recipient (campaign.creator)
			address poolAddr = poolForValidator[getBlame(channel)];
			require(poolAddr != address(0), 'no pool');
			IStakingPool(poolAddr).claim(channel.tokenAddr, spender, refundableDeposit);
		} else {
			if (remainingFunds < refundableDeposit) {
				// Note the liquidation itself is a resposibility of the staking contract
				// the rationale is that some staking pools might hold LP tokens, so the liquidation logic should be in the pool
				address poolAddr = poolForValidator[getBlame(channel)];
				require(poolAddr != address(0), 'no pool');
				IStakingPool(poolAddr).claim(channel.tokenAddr, address(this), refundableDeposit-remainingFunds);
				remainingFunds = refundableDeposit;
			}

			remaining[channelId] = remainingFunds - refundableDeposit;
			SafeERC20.transfer(channel.tokenAddr, spender, refundableDeposit);
		}
	}
}
