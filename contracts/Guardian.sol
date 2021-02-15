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

	constructor() {
		owner = msg.sender;
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

	function challenge(OUTPACE outpace, OUTPACE.Channel calldata channel) external {
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
	
	// @TODO; should we cache blame?
	function getRefund(OUTPACE outpace, OUTPACE.Channel calldata channel, address spender, uint spentAmount, bytes32[] calldata proof) external {
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

		bytes32 balanceLeaf = keccak256(abi.encode('spender', spender, spentAmount));
		require(MerkleProof.isContained(balanceLeaf, proof, outpace.lastStateRoot(channelId)), 'balance leaf not found');
		uint refundableDeposit = (totalDeposited-spentAmount) * interestPromilles / 1000;

		if (outpace.challenges(channelId) != type(uint256).max) {
			//require(remaining == 0) // make sure our internal state makes sense
			// @TODO also require that some additional time is passed (eg 1 week)
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
