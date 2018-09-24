pragma solidity 0.4.24;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/libs/BidLibrary.sol";

contract TestBidLibrary {
	using BidLibrary for BidLibrary.Bid;

	function testBidLibrary() public {
		address[] memory validators;
		uint[] memory validatorRewards;
		BidLibrary.Bid memory bid = BidLibrary.Bid({
			advertiser: address(this),
			adUnit: 0x0,
			goal: 0x0,
			timeout: 60,
			tokenAddr: address(0x0),
			tokenAmount: 1,
			openedTime: now,
			validators: validators,
			validatorRewards: validatorRewards
		});

		Assert.equal(bid.isValid(), true, "Bid should be valid");
		
		// test isValid conditions
		// test if timeout is checked
	}

	// as for the commitment library test, we should
	// 1) ensure timeout can happen: timeoutAfter is properly set so we can timeout
	// 2) ensure finalize can happen: ensure reward > 0 and !(rewardSum > reward)
}