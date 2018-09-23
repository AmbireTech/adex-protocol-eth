pragma solidity 0.4.24;

import "./BidLibrary.sol";

library CommitmentLibrary {
	struct Commitment {
		// because it contains the bidId, we don't need to hash address(this)
		bytes32 bidId;

		address tokenAddr;
		uint tokenAmount;

		uint validUntil;

		address advertiser; // buyer
		address publisher; // seller

		address[] validators;
		uint[] validatorRewards;
	}
	// can be serialized to (bidId, commitmentAddrs, commitmentValues, validators, validatorRewards)

	function hash(Commitment memory commitment) internal pure returns (bytes32) {
		// In this version of solidity, we can no longer keccak256() directly
		return keccak256(abi.encodePacked(
			commitment.bidId,
			commitment.tokenAddr,
			commitment.tokenAmount,
			commitment.validUntil,
			commitment.advertiser,
			commitment.publisher,
			commitment.validators,
			commitment.validatorRewards
		));
	}

	function fromValues(bytes32[6] values, address[] validators, uint[] validatorRewards)
		internal
		pure
		returns (Commitment memory)
	{
		return Commitment({
			bidId: values[0],
			tokenAddr: address(values[1]),
			tokenAmount: uint(values[2]),
			validUntil: uint(values[3]),
			publisher: address(values[4]),
			advertiser: address(values[5]),
			validators: validators,
			validatorRewards: validatorRewards
		});
	}

	function fromBid(BidLibrary.Bid memory bid, address extraValidator, uint extraValidatorReward)
		internal
		pure
		returns (Commitment memory)
	{
		// @TODO
	}
}