pragma solidity ^0.4.25;
pragma experimental ABIEncoderV2;

import "./libs/ChannelLibrary.sol";

contract AdExCoreInterface {
	event LogChannelOpen(bytes32 channelId);
	event LogChannelWithdraw(bytes32 channelId, uint amount);
	event LogChannelExpiredWithdraw(bytes32 channelId, uint amount);
	// @TODO functions
	function getChannelState(bytes32 channelId) view external returns (uint8);
	function getChannelWithdrawn(bytes32 channelId) view external returns (uint);
}
