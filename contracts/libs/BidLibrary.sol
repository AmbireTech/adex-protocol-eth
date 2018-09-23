pragma solidity ^0.4.24;

contract BidLibrary {
	enum BidState { 
		// Unknown means it does not exist on-chain, i.e. there's never been a DeliveryCommitment for it
		Unknown,

		Active,

		// fail states
		Canceled,
		// the following 2 states MUST unlock the reward amount (return to advertiser)
		DeliveryTimedOut,
		DeliveryFailed,

		// success states
		DeliverySucceeded
	}

	struct Bid {
		address exchange;

		address advertiser;
		bytes32 adUnit;

		// Requirements
		bytes32 goal;
		uint timeout;

		// Reward
		address tokenAddr;
		uint tokenAmount;

		// @TODO: should tihs be 'nonce'?
		uint openedTime;

		address[] validators;
		uint[] validatorRewards;
	}
}