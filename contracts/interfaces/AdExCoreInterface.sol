pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "../libs/ChannelLibrary.sol";

contract AdExCoreInterface {
	function channelOpen(ChannelLibrary.Channel memory channel) public;
	function channelWithdrawExpired(ChannelLibrary.Channel memory channel) public;
	function channelWithdraw(ChannelLibrary.Channel memory channel, bytes32 stateRoot, bytes32[3][] memory signatures, bytes32[] memory proof, uint amountInTree) public;
}
