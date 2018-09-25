pragma solidity 0.4.24;

import "../../contracts/libs/BidLibrary.sol";
import "../../contracts/libs/CommitmentLibrary.sol";

contract Libs {
	using BidLibrary for BidLibrary.Bid;
	using CommitmentLibrary for CommitmentLibrary.Commitment;

	function bidHash(bytes32[7] vals, address[] validators, uint[] validatorRewards) public view returns (bytes32) {
		BidLibrary.Bid memory bid = BidLibrary.fromValues(vals, validators, validatorRewards);
		return bid.hash();
	}

	function commitmentHash(bytes32[6] vals, address[] validators, uint[] validatorRewards) public pure returns (bytes32) {
		CommitmentLibrary.Commitment memory commitment = CommitmentLibrary.fromValues(vals, validators, validatorRewards);
		return commitment.hash();
	}
}
