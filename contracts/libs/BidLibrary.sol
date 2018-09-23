pragma solidity 0.4.25;

library BidLibrary {
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
	// can be serialized to (addresses, values, validators, validatorRewards)

    function hash(Bid memory bid) internal view returns (bytes32) {
    	// In this version of solidity, we can no longer keccak256() directly
        return keccak256(abi.encodePacked(
            address(this),
            bid.advertiser,
            bid.adUnit,
            bid.goal,
            bid.timeout,
            bid.tokenAddr,
            bid.tokenAmount,
            bid.openedTime,
            this
        ));
    }
}