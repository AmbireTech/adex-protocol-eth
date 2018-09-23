pragma solidity 0.4.25;

import "./libs/BidLibrary.sol";

library DeliveryCommitmentLibrary {
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
	// can be serialized to ... @TODO

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

	function fromBid(BidLibrary.Bid memory bid, address extraValidator, uint extraValidatorReward)
		internal
		pure
		returns (Commitment memory)
	{
		// @TODO
	}
}