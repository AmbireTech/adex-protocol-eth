pragma solidity 0.4.24;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/libs/BidLibrary.sol";

contract TestBidLibrary {
	using BidLibrary for BidLibrary.Bid;

	function testBidLibraryIsValid() public {
		address[] memory validators;
		uint[] memory validatorRewards;

		address[] memory validators1;
		validators1 = new address[](1);

		BidLibrary.Bid memory bid = BidLibrary.Bid({
			advertiser: address(this),
			adUnit: 0x0,
			goal: 0x0,
			timeout: 60,
			tokenAddr: address(0x0),
			tokenAmount: 1,
			nonce: 1537791457450,
			validators: validators,
			validatorRewards: validatorRewards
		});

		Assert.equal(bid.isValid(), true, "Bid should be valid");

		bid.tokenAmount = 0;
		Assert.equal(bid.isValid(), false, "Bid is not valid, tokenAmount");

		bid.tokenAmount = 1;
		bid.validators = validators1;
		Assert.equal(bid.isValid(), false, "Bid is not valid, validators length");

		bid.validators = validators;
		Assert.equal(bid.isValid(), true, "Bid is valid again");

		bid.timeout = 0;
		Assert.equal(bid.isValid(), false, "Bid is not valid (timeout)");

		bid.timeout = 400 days;
		Assert.equal(bid.isValid(), false, "Bid is not valid (timeout)");

		bid.timeout = 2 days;
		Assert.equal(bid.isValid(), true, "Bid is valid again");
	}

	// @TODO: fromValues()
	// @TODO .hash()

	// as for the commitment library test, we should
	// 1) ensure timeout can happen: timeoutAfter is properly set so we can timeout
	// 2) ensure finalize can happen: ensure reward > 0 and !(rewardSum > reward)
}