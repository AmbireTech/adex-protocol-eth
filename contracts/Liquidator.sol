// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.0;

interface IOUTPACE {
	function deposits(bytes32 channelId, bytes32 depositId) external view returns (uint);
}

contract Liquidator {
	struct Campaign {
		// @TODO do we need the channelId if outpace is already segmenting?
		// probably not
		bytes32 channelId;
		address creator;
		uint refundEpoch;
		bytes32 spec;
	}

	mapping (address => address) public poolForValidator;

	function registerPool(address pool) external {
		require(poolForValidator[msg.sender] == address(0));
		poolForValidator[msg.sender] = pool;
	}

	function getBlame(Campaign memory campaign) internal {

	}
	//function getRefund()

}
