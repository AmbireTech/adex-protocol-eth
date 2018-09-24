pragma solidity 0.4.24;

import "./libs/SafeMath.sol";
import "./libs/SignatureValidator.sol";
import "./libs/SafeERC20.sol";
import "./libs/BidLibrary.sol";
import "./libs/CommitmentLibrary.sol";
import "./AdExCoreInterface.sol";

// AUDIT: Things we should look for
// 1) Every time we check if the state is Active, we also check commitment hash
// 2) every time we check the state, the function should either revert or change the state
// 3) state transition: CommitmentLibrary.CommitmentStart locks up tokens, then Finalize and Timeout can always unlock
// 4) every time we transition out of BidState.Active, we should delete commitments[]

contract AdExCore is AdExCoreInterface {
	using SafeMath for uint;
	using BidLibrary for BidLibrary.Bid;
	using CommitmentLibrary for CommitmentLibrary.Commitment;

	// assets (tokenAddr => (account => uint))
	mapping (address => mapping (address => uint)) private balances;

 	// bidId => bidState
	mapping (bytes32 => BidLibrary.State) public states;
	// bidId => commitmentId
	mapping (bytes32 => bytes32) public commitments;

	// Public Functions
	constructor() public {}

	function deposit(address token, uint amount)
		external
	{
		balanceAdd(token, msg.sender, amount);
		SafeERC20.transferFrom(token, msg.sender, address(this), amount);

		emit LogDeposit(msg.sender, token, amount);
	}

	function withdraw(address token, uint amount)
		external
	{
		require(amount <= balances[token][msg.sender]);

		balanceSub(token, msg.sender, amount);
		SafeERC20.transfer(token, msg.sender, amount);

		emit LogWithdrawal(msg.sender, token, amount);
	}

	// Shim that will be removed once solidity supports external functions with structs in their args
	// Then, we will delete the next 4 functions and just rename all *Internal and change their visibility
	function bidCancel(bytes32[7] bidValues, address[] bidValidators, uint[] bidValidatorRewards) external {
		bidCancelInternal(BidLibrary.fromValues(bidValues, bidValidators, bidValidatorRewards));
	}
	function commitmentStart(bytes32[7] bidValues, address[] bidValidators, uint[] bidValidatorRewards, bytes32[3] signature, address extraValidator, uint extraValidatorReward) external {
		commitmentStartInternal(BidLibrary.fromValues(bidValues, bidValidators, bidValidatorRewards), signature, extraValidator, extraValidatorReward);
	}
	function commitmentTimeout(bytes32[6] cValues, address[] cValidators, uint[] cValidatorRewards) external {
		commitmentTimeoutInternal(CommitmentLibrary.fromValues(cValues, cValidators, cValidatorRewards));
	}
	function commitmentFinalize(bytes32[6] cValues, address[] cValidators, uint[] cValidatorRewards, bytes32[3][] signatures, bytes32 vote) external {
		commitmentFinalizeInternal(CommitmentLibrary.fromValues(cValues, cValidators, cValidatorRewards), signatures, vote);
	}

	// Internal functions
	function bidCancelInternal(BidLibrary.Bid memory bid)
		internal
	{
		require(msg.sender == bid.advertiser);

		bytes32 bidId = bid.hash();

		require(states[bidId] == BidLibrary.State.Unknown);
		states[bidId] = BidLibrary.State.Canceled;

		emit LogBidCancel(bidId);
	}

	function commitmentStartInternal(BidLibrary.Bid memory bid, bytes32[3] signature, address extraValidator, uint extraValidatorReward)
		internal
	{
		bytes32 bidId = bid.hash();
		require(states[bidId] == BidLibrary.State.Unknown);
		require(bid.isValid());

		// Check if validly signed and the advertiser has the funds
		require(SignatureValidator.isValidSignature(bidId, bid.advertiser, signature));
		require(balances[bid.tokenAddr][bid.advertiser] >= bid.tokenAmount);

		CommitmentLibrary.Commitment memory commitment = CommitmentLibrary.fromBid(bid, bidId, msg.sender, extraValidator, extraValidatorReward);
		bytes32 commitmentId = commitment.hash();

		require(commitment.isValid());

		states[bidId] = BidLibrary.State.Active;
		commitments[bidId] = commitmentId;

		balanceSub(bid.tokenAddr, bid.advertiser, bid.tokenAmount);
		balanceAdd(bid.tokenAddr, address(this), bid.tokenAmount);

		emit LogBidCommitment(bidId, commitmentId);
	}

	function commitmentTimeoutInternal(CommitmentLibrary.Commitment memory commitment)
		internal
	{
		require(states[commitment.bidId] == BidLibrary.State.Active);
		require(commitments[commitment.bidId] == commitment.hash());
		require(now > commitment.validUntil);

		states[commitment.bidId] = BidLibrary.State.DeliveryTimedOut;
		delete commitments[commitment.bidId];

		balanceSub(commitment.tokenAddr, address(this), commitment.tokenAmount);
		balanceAdd(commitment.tokenAddr, commitment.advertiser, commitment.tokenAmount);

		emit LogBidTimeout(commitment.bidId);
	}

	function commitmentFinalizeInternal(CommitmentLibrary.Commitment memory commitment, bytes32[3][] signatures, bytes32 vote)
		internal
	{
		require(states[commitment.bidId] == BidLibrary.State.Active);
		require(commitments[commitment.bidId] == commitment.hash());
		// @TODO check if it's not timed out (??)

		// Unlock the funds
		balanceSub(commitment.tokenAddr, address(this), commitment.tokenAmount);

		bytes32 hashToSign = keccak256(abi.encodePacked(commitment.hash(), vote));
		uint remaining = commitment.tokenAmount;
		uint votes = 0;
		require(signatures.length <= commitment.validators.length);
		for (uint i=0; i<signatures.length; i++) {
			// NOTE: if a validator has not signed, you can just use SignatureMode.NO_SIG
			if (SignatureValidator.isValidSignature(hashToSign, commitment.validators[i], signatures[i])) {
				votes++;
				balanceAdd(commitment.tokenAddr, commitment.validators[i], commitment.validatorRewards[i]);
				// if the sum of all validatorRewards is more than tokenAmount, this will eventually revert
				// however, we still check in commitment.isValid() to ensure there are no non-finalizable commitments
				remaining = remaining.sub(commitment.validatorRewards[i]);
			}
		}

		// Always require supermajority; we're checking the same vote, so this means 2/3 validators signed the same vote
		require(votes*3 >= commitment.validators.length*2);

		if (vote != 0x0) {
			states[commitment.bidId] = BidLibrary.State.DeliverySucceeded;
			balanceAdd(commitment.tokenAddr, commitment.publisher, remaining);
		} else {
			states[commitment.bidId] = BidLibrary.State.DeliveryFailed;
			balanceAdd(commitment.tokenAddr, commitment.advertiser, remaining);
		}
		delete commitments[commitment.bidId];

		emit LogBidFinalize(commitment.bidId, vote);
	}

	// A few internal helpers
	function balanceSub(address token, address acc, uint amount) internal {
		balances[token][acc] = balances[token][acc].sub(amount);
	}
	function balanceAdd(address token, address acc, uint amount) internal {
		balances[token][acc] = balances[token][acc].add(amount);
	}
}
