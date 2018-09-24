pragma solidity 0.4.24;

import "truffle/Assert.sol";
import "truffle/DeployedAddresses.sol";
import "../contracts/libs/BidLibrary.sol";
import "../contracts/libs/CommitmentLibrary.sol";

contract TestBidAndCommitmentLibraries {
	using BidLibrary for BidLibrary.Bid;
	using CommitmentLibrary for CommitmentLibrary.Commitment;

	function testBidLibraryIsValid() public {
		address[] memory validators;
		uint[] memory validatorRewards;

		address[] memory validators1;
		validators1 = new address[](1);

		BidLibrary.Bid memory bid = newTestBid(validators, validatorRewards);

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

	function testBidLibraryHash() public {
		address[] memory validators;
		uint[] memory validatorRewards;

		address[] memory validators1;
		validators1 = new address[](1);

		BidLibrary.Bid memory bid1 = newTestBid(validators, validatorRewards);
		BidLibrary.Bid memory bid2 = newTestBid(validators, validatorRewards);

		Assert.equal(bid1.hash(), bid2.hash(), "Bid hash is the same b/w identical bids");

		bid1.tokenAmount = 22;
		Assert.notEqual(bid1.hash(), bid2.hash(), "Bid hash changes when the token amount is changed");

		bid1.tokenAmount = 1;
		Assert.equal(bid1.hash(), bid2.hash(), "Bid hash is identical again");

		bid1.validators = validators1;
		Assert.notEqual(bid1.hash(), bid2.hash(), "Bid hash changes when the validator set is changed");
	}


	// as for the commitment library test, we should
	// 1) ensure timeout can happen: timeoutAfter is properly set so we can timeout
	// 2) ensure finalize can happen: ensure reward > 0 and !(rewardSum > reward)
	function testCommitmentFromBid() public {
		address[] memory validators1 = new address[](2);
		uint[] memory validatorRewards1 = new uint[](2);
		address publisher = address(this);

		BidLibrary.Bid memory bid = newTestBid(validators1, validatorRewards1);
		CommitmentLibrary.Commitment memory comm1 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, 0x0, 0);
		Assert.equal(comm1.bidId, bid.hash(), "commitment has right bidId");
		Assert.equal(comm1.publisher, publisher, "commitment has right publisher");
		Assert.equal(comm1.validators.length, 2, "commitment has right validator length");

		CommitmentLibrary.Commitment memory comm2 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, 0x1, 1);
		Assert.equal(comm2.bidId, bid.hash(), "commitment has right bidId");
		Assert.equal(comm2.validators.length, 3, "commitment has an extra validator");
		Assert.equal(comm2.validatorRewards.length, 3, "commitment validatorRewards is right length");
	}

	function testCommitmentIsValid() public {
		address[] memory validators1 = new address[](2);
		uint[] memory validatorRewards1 = new uint[](2);

		address[] memory validators2;
		uint[] memory validatorRewards2;

		address publisher = address(this);
		BidLibrary.Bid memory bid = newTestBid(validators1, validatorRewards1);

		CommitmentLibrary.Commitment memory comm1 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, 0x0, 0x0);
		Assert.equal(comm1.isValid(), false, "Commitment is not valid cause it does not have enough validators");

		CommitmentLibrary.Commitment memory comm2 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, address(this), 1);
		Assert.equal(comm2.isValid(), true, "Commitment is valid cause we added an extra validator");
		comm2.validatorRewards = validatorRewards1;
		Assert.equal(comm2.isValid(), false, "Commitment is not valid cause validators.length != validatorRewards.length");

		CommitmentLibrary.Commitment memory comm3 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, address(this), bid.tokenAmount+1);
		Assert.equal(comm3.isValid(), false, "Commitment is not valid cause the sum of all validator rewards is more than the token reward");

		BidLibrary.Bid memory bid2 = newTestBid(validators2, validatorRewards2);
		CommitmentLibrary.Commitment memory comm4 = CommitmentLibrary.fromBid(bid2, bid2.hash(), publisher, address(this), 1);
		Assert.equal(comm4.isValid(), false, "Commitment is not valid cause it does not have enough validators");
	}

	function testCommitmentHash() public {
		address[] memory validators1 = new address[](3);
		uint[] memory validatorRewards1 = new uint[](3);

		address publisher = address(this);
		BidLibrary.Bid memory bid = newTestBid(validators1, validatorRewards1);

		CommitmentLibrary.Commitment memory comm1 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, 0x0, 0x0);
		Assert.equal(comm1.isValid(), true, "Commitment 1 is valid");

		CommitmentLibrary.Commitment memory comm2 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, 0x0, 0x0);
		Assert.equal(comm2.isValid(), true, "Commitment 2 is valid");

		Assert.equal(comm1.hash(), comm2.hash(), "The two commitments have the same hash");

		comm1.validators = new address[](3);
		comm1.validators[0] = address(this);
		Assert.notEqual(comm1.hash(), comm2.hash(), "hash changed when changing validator set");

		comm1.validators = comm2.validators;
		comm1.validatorRewards = comm2.validatorRewards;
		Assert.equal(comm1.hash(), comm2.hash(), "The two commitments have the same hash");

		comm1.bidId = bytes32(0xdeadbeef);
		Assert.notEqual(comm1.hash(), comm2.hash(), "hash changed when changing bidId");

		CommitmentLibrary.Commitment memory comm3 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, 0x0, 0);
		comm3.validators = new address[](4);
		comm3.validatorRewards = new uint[](4);
		comm3.validators[3] = address(this);
		comm3.validatorRewards[3] = 1;
		CommitmentLibrary.Commitment memory comm4 = CommitmentLibrary.fromBid(bid, bid.hash(), publisher, address(this), 1);
		Assert.equal(comm3.hash(), comm4.hash(), "hash reproducable with extra validator");
	}

	//
	// Internals
	//
	function newTestBid(address[] memory validators, uint[] memory validatorRewards)
		internal
		pure
		returns (BidLibrary.Bid memory)
	{
		return BidLibrary.Bid({
			advertiser: address(0x1),
			adUnit: 0x0,
			goal: 0x0,
			timeout: 60,
			tokenAddr: address(0x0),
			tokenAmount: 1,
			nonce: 1537791457450,
			validators: validators,
			validatorRewards: validatorRewards
		});
	}
}