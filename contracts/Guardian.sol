// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "./OUTPACE.sol";
import "./libs/SafeERC20.sol";

interface IStakingPool {
	function claim(address tokenOut, address to, uint amount) external;
}

contract Guardian {
	// validator => pool contract
	mapping (address => address) public poolForValidator;
	// validator -> refundInterestPromilles
	mapping (address => uint) public refundInterestPromilles;
	// channelId -> remaining funds we hold but haven't distributed
	mapping (bytes32 => uint) public remaining;
	// channelId => spender => isRefunded
	mapping (bytes32 => mapping(address => bool)) refunds;
	OUTPACE outpace;

	constructor(OUTPACE _outpace) {
		outpace = _outpace;
	}

	function registerPool(address pool, uint interestPromilles) external {
		require(poolForValidator[msg.sender] == address(0), 'STAKING_ALREADY_REGISTERED');
		poolForValidator[msg.sender] = pool;
		refundInterestPromilles[msg.sender] = interestPromilles;
		// NOTE: later on, we can implement an 'initiation fee' here
		// Which would be calling claim() here on some small amount, to ensure the claim process works for the given pool
	}

	function setRefundPromilles(uint interestPromilles) external {
		require(interestPromilles < 500, 'REFUND_PROMILLES_BOUNDS');
		refundInterestPromilles[msg.sender] = interestPromilles;
	}
	
	function getRefund(OUTPACE.Channel calldata channel, address spender, uint spentAmount, bytes32[] calldata proof) external {
		require(channel.guardian == address(this), 'NOT_GUARDIAN');
		bytes32 channelId = keccak256(abi.encode(channel));

		require(!refunds[channelId][spender], 'REFUND_ALREADY_RECEIVED');
		refunds[channelId][spender] = true;

		// Verify the spendable amount leaf
		bytes32 lastStateRoot = outpace.lastStateRoot(channelId);
		// if lastStateRoot is 0, spentAmount can also be 0 without verification
		if (!(spentAmount == 0 && lastStateRoot == bytes32(0))) {
			bytes32 balanceLeaf = keccak256(abi.encode('spender', spender, spentAmount));
			require(MerkleProof.isContained(balanceLeaf, proof, lastStateRoot), 'BALANCELEAF_NOT_FOUND');
		}

		uint remainingFunds = remaining[channelId];
		uint totalDeposited = outpace.deposits(channelId, spender);
		uint refundable = totalDeposited - spentAmount;
		address blamed = channel.leader; // getBlame(channel);
		address poolAddr = poolForValidator[blamed];
		// Do not apply the interest multiplier if there is no lastStateRoot (channel has not been used)
		// cause without it, it's possible to open non-legit channels with real validators, let them expire and try to claim the interest
		// Only apply the interest if the channel has been used and there's a pool from which to get it
		if (lastStateRoot != bytes32(0) && poolAddr != address(0)) {
			refundable = refundable * (refundInterestPromilles[blamed] + 1000) / 1000;
		}

		// Ensure the channel is closed (fail if it can't be closed yet)
		uint challengeExpires = outpace.challenges(channelId);
		if (challengeExpires != type(uint256).max) {
			// Allow another 5 days before we can call .close(), giving more time to participants to withdraw
			require(block.timestamp > challengeExpires + 5 days, 'TOO_EARLY');
			require(remainingFunds == 0, 'INTERNAL_ERR');
			remainingFunds = outpace.remaining(channelId);
			outpace.close(channel);
		}

		// Finally, distribute the funds, and only use claim() if needed
		if (remainingFunds == 0) {
			// Optimizing the case in which remaining has ran out - then we just claim directly to the recipient (campaign.creator)
			require(poolAddr != address(0), 'FUNDS_REQUIRED_NO_POOL');
			IStakingPool(poolAddr).claim(channel.tokenAddr, spender, refundable);
		} else {
			if (remainingFunds < refundable) {
				// Note the liquidation itself is a resposibility of the staking contract
				// the rationale is that some staking pools might hold LP tokens, so the liquidation logic should be in the pool
				require(poolAddr != address(0), 'FUNDS_REQUIRED_NO_POOL');
				IStakingPool(poolAddr).claim(channel.tokenAddr, address(this), refundable - remainingFunds);
				remainingFunds = refundable;
			}

			remaining[channelId] = remainingFunds - refundable;
			SafeERC20.transfer(channel.tokenAddr, spender, refundable);
		}
	}
}
