const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

const Bid = require('../js/Bid').Bid
const Commitment = require('../js/Commitment').Commitment

const Web3 = require('web3')

contract('AdExCore', function(accounts) {
	let token
	let core

	before(async function() {
		token = await MockToken.new()
		libMock = await MockLibs.new()
		core = await AdExCore.deployed()
	})

	it('deposit and withdraw', async function() {
		const acc = accounts[0]
		const minted = 666
		const deposited = 300
		const withdrawn = 200

		// NOTE: the mock token does not require allowance to be set
		await token.setBalanceTo(acc, minted)

		await core.deposit(token.address, deposited, { from: acc })
		assert.equal((await core.balanceOf(token.address, acc)).toNumber(), deposited, 'correct amount deposited')
		assert.equal((await token.balanceOf(acc)).toNumber(), minted-deposited, 'amount was taken off the token')

		await core.withdraw(token.address, withdrawn, { from: acc })
		assert.equal((await core.balanceOf(token.address, acc)).toNumber(), deposited-withdrawn, 'correct amount on core')
		assert.equal((await token.balanceOf(acc)).toNumber(), (minted-deposited)+withdrawn, 'amount is now on token')
	})

	it('bid and commitment hashes match', async function() {
		const { bid, commitment } = getTestValues()

		const bidHashLocal = bid.hash(core.address);
		const bidHashContract = await libMock.bidHash(bid.values(), bid.validators, bid.validatorRewards)
		assert.equal(bidHashLocal, bidHashContract, 'bid: JS lib outputs same hash as the solidity lib')

		const commHashLocal = commitment.hash();
		const commHashContract = await libMock.commitmentHash(commitment.values(), commitment.validators, commitment.validatorRewards)
		assert.equal(commHashLocal, commHashContract, 'commitment: JS lib outputs the same hash as the solidity lib')
	})

	// @TODO cannot withdraw more than we've deposited, even though the core has the balance

	// @TODO: ensure timeouts always work
	// ensure there is a max timeout
	// ensure we can't get into a istuation where we can't finalize (e.g. validator rewards are more than the total reward)
	// ensure calling finalize (everything for that matter, except deposit/withdraw) is always zero-sum on balances
	// @TODO to protect against math bugs, check common like: 1/2 validators voting (fail), 2/2 (success); 1/3 (f), 2/3 (s), 3/3 (s), etc.

	// UTILS
	function getTestValues() {
		const bid = new Bid({
			advertiser: accounts[0],
			adUnit: Web3.utils.randomHex(32),
			goal: Web3.utils.randomHex(32),
			timeout: 24*60*60,
			tokenAddr: token.address,
			tokenAmount: 2000,
			nonce: Date.now(),
			validators: [accounts[0], accounts[1], accounts[2]],
			validatorRewards: [10, 11, 12]
		})
		// NOTE: should we have a fromBid to replicate solidity libs?
		const commitment = new Commitment({
			bidId: Web3.utils.randomHex(32),//bid.hash(),
			tokenAddr: bid.tokenAddr,
			tokenAmount: bid.tokenAmount,
			validUntil: Math.floor(Date.now()/1000)+24*60*60,
			advertiser: accounts[0],
			publisher: accounts[1],
			validators: bid.validators,
			validatorRewards: bid.validatorRewards
		})
		return { bid, commitment }
	}
})
