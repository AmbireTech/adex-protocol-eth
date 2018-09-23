pragma solidity ^0.4.24;

import "./libs/SafeMath.sol";
import "./libs/Bid.sol";
import "./libs/DeliveryCommitment.sol";
import "./AdExCoreInterface.sol";

// Things we can static-analyze
// 1) Every time we check if the state is active, we also check delivery commitment hash
// 2) every time we check the state, the function should either revert or change the state
// 3) state transition: deliveryCommitmentStart locks up tokens, then Finalize and Timeout can always unlock
// 4) every time we transition out of BidState.Active, we should delete commitments[]

contract AdExCore is AdExCoreInterface {
	using SafeMath for *;
	using BidLibrary for BidLibrary.Bid;
	using DeliveryCommitmentLibrary for DeliveryCommitmentLibrary.Commitment;

	// assets (tokenAddr => (account => uint))
	mapping (address => mapping (address => uint)) private balances;

 	// bidId => bidState
	mapping (bytes32 => BidState) public states;
	// bidId => commitmentId
	mapping (bytes32 => bytes32) public commitments;

	// Public Functions
	function ADXCore() public {
	}

	// The bid is canceled by the advertiser
	function cancelBid(Bid memory bid)
		public
	{
		require(msg.sender == bid.advertiser);

		bytes32 memory bidId = bid.hash();

		require(states[bidId] == BidState.Unknown);
		states[bidId] = BidState.Canceled;

		LogBidCanceled(bidId);
	}

	// the bid is accepted by the publisher
	function deliveryCommitmentStart(Bid memory bid, bytes32 bidSig, address validator, uint validatorReward)
		public
	{
		bytes32 memory bidId = bid.hash();
		require(states[bidId] == BidState.Unknown);

		// Check if validly signed and advertiser has the funds
		address memory signer = bid.getSigner(bidSig);
		require(signer == bid.advertiser);
		require(balances[bid.tokenAddr][bid.advertiser] >= bid.tokenAmount);

		DeliveryCommitment memory commitment = DeliveryCommitment.fromBid(bid, msg.sender, validator, validatorReward);
		states[bidId] = BidState.Active;
		commitment[bidId] = commitment.hash();

		balanceSub(bid.tokenAddr, bid.advertiser, bid.tokenAmount);
		balanceAdd(bid.tokenAddr, address(this), bid.tokenAmount);
		// @TODO log event
	}

	// This can be done if a bid is accepted, but expired
	// @TODO docs
	function deliveryCommitmentTimeout(bytes32 bidId, DeliveryCommitment memory commitment)
		public
	{
		require(states[bidId] == BidState.Active);
		require(commitments[bidId] == commitment.hash());
		require(now > commitment.validUntil);

		states[bidId] = BidState.DeliveryTimedOut;
		delete commitment[bidId];

		balanceSub(commitment.tokenAddr, address(this), commitment.tokenAmount);
		balanceAdd(commitment.tokenAddr, commitment.advertiser, commitment.tokenAmount);

		LogBidExpired(bidId);
	}


	// both publisher and advertiser have to call this for a bid to be considered verified
	function deliveryCommitmentFinalize(bytes32 bidId, DeliveryCommitment memory commitment, bytes32[] sigs, bytes32 vote)
		public
	{
		// @AUDIT: ensure the sum of all balanceSub/balanceAdd is 0
		require(states[bidId] == BidState.Active);
		require(commitment[bidId] == commitment.hash());
		// @TODO check if it's not timed out (??)

		uint memory remaining = commitment.tokenAmount;
		uint memory votes = 0;
		uint memory sigLen = sigs.length;
		for (uint i=0; i<sigLen; i++) {
			if (sigs[i] == 0x0) {
				continue;
			}
			if (commitment.didSignVote(i, sigs[i], vote)) {
				votes++;
				balanceAdd(commitment.tokenAddr, commitment.validators[i], commitment.validatorReward[i]);
				// if the sum of al validatorRewards is more than tokenAmount, this will revert eventually
				remaining = remaining.sub(commitment.validatorReward[i]);
			}
		}

		// Always require supermajority
		require(votes*3 >= commitment.validators.length*2);

		delete commitments[bidId];

		if (vote != 0x0) {
			states[bidId] = BidState.DeliverySucceeded;
			balanceAdd(commitment.tokenAddr, commitment.publisher, remaining);
		} else {
			states[bidId] =BidState.DeliveryFailed;
			balanceAdd(commitment.tokenAddr, commitment.advertiser, remaining);
		}
		balanceSub(commitment.tokenAddr, address(this), commitment.tokenAmount);

		// @TODO: log event
	}

	// @TODO: ERC20 hack
	function deposit(address token, uint amount)
		external
	{
		balanceAdd(token, msg.sender, amount);
		require(new ERC20(token).transferFrom(msg.sender, address(this), amount));

		LogDeposit(msg.sender, token, amount);
	}

	function withdraw(address token, uint amount)
		external
	{
		require(amount <= balances[token][msg.sender]);

		balanceSub(token, msg.sender, amount);
		require(new ERC20(token).transfer(msg.sender, amount));

		LogWithdrawal(msg.sender, token, amount);
	}

	// Internals
	function balanceSub(address token, address acc, uint amount) internal {
		balances[token][acc] = balances[token][acc].sub(amount);
	}
	function balanceAdd(address token, address acc, uint amount) internal {
		balances[token][acc] = balances[token][acc].add(amount);
	}
}
