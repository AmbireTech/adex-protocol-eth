pragma solidity 0.4.25;

import "./libs/BidLibrary.sol";
import "./libs/CommitmentLibrary.sol";

contract AdExCoreInterface {
	// @TODO events

	function bidCancel(uint[7] bidValues, address[] bidValidators, uint[] bidValidatorRewards) external;

	function deliveryCommitmentStart(uint[7] bidValues, address[] bidValidators, uint[] bidValidatorRewards, bytes signature, address extraValidator, uint extraValidatorReward) external;
	function deliveryCommitmentTimeout(bytes32[6] cValues, address[] cValidators, uint[] cValidatorRewards) external;
	function deliveryCommitmentFinalize(bytes32[6] cValues, address[] cValidators, uint[] cValidatorRewards, bytes[] signatures, bytes32 vote);

	function deposit(address token, uint amount) external;
	function withdraw(address token, uint amount) external;
}