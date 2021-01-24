// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

import "./libs/SafeERC20.sol";

interface IOUTPACE {
	// WARINNG: copy paste from OUTPACE!
	struct Channel {
		address leader;
		address follower;
		address guardian;
		address tokenAddr;
		bytes32 nonce;
	}

	function deposits(bytes32 channelId, bytes32 depositId) external view returns (uint);
	function remaining(bytes32 channelId) external view returns (uint);
	// @TODO: impl
	function isClosed(bytes32 channelId) external view returns (bool);
	function close(Channel calldata channel) external;
}

interface IStakingPool {
	function claim(address tokenOut, address to, uint amount) external;
}

contract Guardian {
	struct Campaign {
		// @TODO do we need the channelId if outpace is already segmenting?
		// probably not
		bytes32 channelId;
		address creator;
		uint refundEpoch;
		bytes32 spec;
	}
	// variables
	address public court;
	mapping (address => address) public poolForValidator;
	mapping (bytes32 => uint) public remaining;
	mapping (bytes32 => mapping(bytes32 => bool)) refunds;

	function registerPool(address pool) external {
		require(poolForValidator[msg.sender] == address(0), 'staking pool already registered');
		poolForValidator[msg.sender] = pool;
	}

	function getBlame(IOUTPACE.Channel memory channel) internal pure returns (address) {
		//if (court == address(0)) return channel.leader;
		//else ICourt(court).getBlame(channel);
		// @TODO court
		return channel.leader;
	}
	// @TODO pass in channel
	// @TODO staking pool claim() interface
	
	// @TODO; should we cache blame
	function getRefund(IOUTPACE outpace, IOUTPACE.Channel calldata channel, Campaign calldata campaign) external {
		bytes32 channelId = keccak256(abi.encode(channel));
		require(channelId == campaign.channelId, 'channelId matches');
		// ensure the channel is closed (fail if it can't be closed yet)
		// calculate blame, and how much funds we already got back from the channel, how much we should slash
		// ensure the passed in campaign has a real deposit
		// refund, optionally by slashing

		// code-wise, perhaps make a separate method that gets executed only once that updates all the refund state (for a channel) initially to calculate who's to blame and save what's taken already; perhaps it would be best to liquidate the adx at once now

		// @TODO encode vs encodepacked
		bytes32 depositId = keccak256(abi.encode(campaign));
		require(!refunds[channelId][depositId], 'refund already received');
		refunds[channelId][depositId] = true;

		uint deposit = outpace.deposits(campaign.channelId, depositId);
		uint remainingFunds = remaining[channelId];

		if (!outpace.isClosed(channelId)) {
			//require(remaining == 0) // make sure our internal state makes sense
			// @TODO also require that some additional time is passed (eg 1 week)
			//require(outpace.canBeClosed())

			remainingFunds = outpace.remaining(channelId);
			outpace.close(channel);
			// assign blame now
			//blame[channel] = validator // call court if available
			// @TODO set liquidation allowance
		}

		if (remainingFunds == 0) {
			// @TODO optimizing the case in which remaining has ran out - then we just claim directly to the recipient
			address poolAddr = poolForValidator[getBlame(channel)];
			require(poolAddr != address(0), 'no pool');
			IStakingPool(poolAddr).claim(channel.tokenAddr, campaign.creator, deposit);
		} else {
			if (remainingFunds < deposit) {
				// Note the liquidation itself is a resposibility of the staking contract - because some staking pools might hold LP tokens
				// @TODO get the staking pool - use an internal registry?
				address poolAddr = poolForValidator[getBlame(channel)];
				require(poolAddr != address(0), 'no pool');
				IStakingPool(poolAddr).claim(channel.tokenAddr, address(this), deposit-remainingFunds);
				remainingFunds = deposit;
			}

			remaining[channelId] = remainingFunds - deposit;
			SafeERC20.transfer(channel.tokenAddr, campaign.creator, deposit);
		}
	}

	// @TODO: owner, setCourt
}
