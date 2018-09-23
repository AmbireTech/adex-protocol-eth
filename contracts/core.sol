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
	// @TODO: deliveryCommitmentStart
	function deliveryCommitmentStart(Bid memory bid, address validator, uint validatorReward)
		public
	{
		bytes32 memory bidId = bid.hash();
		require(states[bidId] == BidState.Unknown);

		// @TODO set commitment

		states[bidId] = BidState.Active;
		commitment[bidId] = commitment.hash();

		// deliveryPeriodStart(bid, validator, validatorReward)
		// check if bid is in state Unknown
		// check if the signer (advertiser) has the funds
		// check if the validator reward sum <= total reward
		// build the deliveryPeriod, hash it
		// lock the reward
		// set that the bid is in progress
		// set the deliveryPeriod hash in the mapping
		// return the hash
		balanceSub(bid.tokenAddr, bid.advertiser, bid.tokenAmount);
		balanceAdd(bid.tokenAddr, address(this), bid.tokenAmount);

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
	function deliveryCommitmentFinalize(bytes32 bidId, DeliveryCommitment memory commitment, []bytes32 sigs, bytes32 vote)
		public
	{
		// @TODO: assert in some static way that every time we check if state is Active, we should also check commitments[bidId]
		// and, finally, we change the state
		require(states[bidId] == BidState.Active);
		require(commitment[bidId] == commitment.hash());
		// @TODO check if it's not timed out (??)

		// go through sigs, count the valid ones; don't check ones set to 0x0
		// 	for each valid one, assign the validator reward
		// check if isSupermajority (voteCount*3 >= totalValidators*2)
		// send the REMAINING of the reward to the publisher/advertiser, depending on the vote
		// 	balances[token][adv or pub] += remaining
		// 	balances[token][adv] -= total
		// unlock the reward
		// change state

		states[bidId] = BidState.Success;
		delete commitments[bidId];

		balanceSub(commitment.tokenAddr, address(this), commitment.tokenAmount);
		// @TODO: publisher OR advertiser, remaining amount
		balanceAdd(commitment.tokenAddr, commitment.publisher, commitment.tokenAmount);
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
