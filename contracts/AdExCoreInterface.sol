pragma solidity 0.4.25;

contract AdExCoreInterface {
	function cancelBid(BidLibrary.Bid memory bid) external;

	// function deliveryCommitmentStart(address[2] bidAddresses, uint[5] bidValues, address[] bidValidators, uint[] bidValidatorRewards, bytes signature, address validator, uint validatorReward) external;
	// function deliveryCommitmentTimeout(bytes32 bidId, address[3] commitmentAddrs, uint[2] commitmentValues, address[] validators, uint[] validatorRewards) external;
	// function deliveryCommitmentFinalize(bytes32 bidId, address[3] commitmentAddrs, uint[2] commitmentValues, address[] validators, uint[] validatorRewards, bytes32[] sigs, bytes32 vote);

	function deliveryCommitmentStart(BidLibrary.Bid memory bid, bytes signature, address validator, uint validatorReward) external;
	function deliveryCommitmentTimeout(DeliveryCommitmentLibrary.Commitment memory commitment) external;
	function deliveryCommitmentFinalize(DeliveryCommitmentLibrary.Commitment memory commitment, bytes32[] sigs, bytes32 vote);

	// @TODO events
	// @TODO: should public mappings be here?
	function deposit(address token, uint amount) external;
	function withdraw(address token, uint amount) external;
}