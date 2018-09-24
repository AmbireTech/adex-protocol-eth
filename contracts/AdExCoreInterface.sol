pragma solidity 0.4.24;

import "./libs/BidLibrary.sol";
import "./libs/CommitmentLibrary.sol";

contract AdExCoreInterface {
	// @TODO more events
	event LogDeposit(address user, address token, uint amount);
	event LogWithdrawal(address user, address token, uint amount);

	function bidCancel(bytes32[7] bidValues, address[] bidValidators, uint[] bidValidatorRewards) external;

	function commitmentStart(bytes32[7] bidValues, address[] bidValidators, uint[] bidValidatorRewards, bytes32[3] signature, address extraValidator, uint extraValidatorReward) external;
	function commitmentTimeout(bytes32[6] cValues, address[] cValidators, uint[] cValidatorRewards) external;
	function commitmentFinalize(bytes32[6] cValues, address[] cValidators, uint[] cValidatorRewards, bytes32[3][] signatures, bytes32 vote) external;

	function deposit(address token, uint amount) external;
	function withdraw(address token, uint amount) external;
}