pragma solidity ^0.4.25;
pragma experimental ABIEncoderV2;

import "./libs/ChannelLibrary.sol";

contract AdExCoreInterface {
	event LogChannelOpen(ChannelLibrary.Channel channel);
	event LogChannelWithdraw(ChannelLibrary.Channel channel, uint amount);
	event LogChannelExpiredWithdraw(ChannelLibrary.Channel channel, uint amount);

	// @TODO: functions
	// @TODO: getChannelWithdrawn
	function getChannelState(bytes32 channelId) view external returns (uint8);
}
