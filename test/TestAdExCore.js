const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

const { Bid, BidState } = require('../js/Bid')
const Commitment = require('../js/Commitment').Commitment
const splitSig = require('../js/splitSig')

const Web3 = require('web3')
const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

contract('AdExCore', function(accounts) {
	let token
	let core

	let commitment1

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

		const bidHashLocal = bid.hash(libMock.address);
		const bidHashContract = await libMock.bidHash(bid.values(), bid.validators, bid.validatorRewards)
		assert.equal(bidHashLocal, bidHashContract, 'bid: JS lib outputs same hash as the solidity lib')

		const commHashLocal = commitment.hash();
		const commHashContract = await libMock.commitmentHash(commitment.values(), commitment.validators, commitment.validatorRewards)
		assert.equal(commHashLocal, commHashContract, 'commitment: JS lib outputs the same hash as the solidity lib')
	})

	it('SignatureValidator', async function() {
		const { bid } = getTestValues()
		const hash = bid.hash(libMock.address)
		const sig = splitSig(await ethSign(accounts[0], hash))
		assert.isTrue(await libMock.isValidSig(hash, accounts[0], sig), 'isValidSig returns true for the signer')
		assert.isNotTrue(await libMock.isValidSig(hash, accounts[1], sig), 'isValidSig returns true for a non-signer')
	})

	it('commitmentStart', async function() {
		// @TODO: can start a commitment with an invalid bid
		// @TODO can't with an invalid signature
		// @TODO can't w/o funds
		const { bid } = getTestValues()

		// prepare the advertiser
		// @TODO: web3 1.x where toNumber will not be required
		const initialAdvertiserBal = bid.tokenAmount.toNumber()
		await token.setBalanceTo(bid.advertiser, initialAdvertiserBal)
		await core.deposit(token.address, initialAdvertiserBal, { from: bid.advertiser })

		const initialCoreBal = (await core.balanceOf(token.address, core.address)).toNumber()
		// FYI: validators for the default bid are accounts 0, 1, 2
		// @TODO: case where we do add an extra validator
		const hash = bid.hash(core.address)
		const sig = splitSig(await ethSign(bid.advertiser, hash))
		const publisher = accounts[0]
		const receipt = await core.commitmentStart(bid.values(), bid.validators, bid.validatorRewards, sig, 0x0, 0x0, { from: publisher })

		// @TODO: get the hash of the commitment from the log, and compare against a hash of a commitment that we construct (fromBid)
		const ev = receipt.logs.find(x => x.event === 'LogBidCommitment')
		assert.isOk(ev, 'event found')
		commitment1 = new Commitment({
			bidId: hash,
			tokenAddr: bid.tokenAddr,
			tokenAmount: bid.tokenAmount,
			validUntil: ev.args.validUntil.toNumber(),
			advertiser: bid.advertiser,
			publisher: accounts[0],
			validators: bid.validators,
			validatorRewards: bid.validatorRewards,
		})
		assert.equal(ev.args.commitmentId, commitment1.hash(), 'commitment hash matches')

		const advertiserBal = (await core.balanceOf(token.address, bid.advertiser)).toNumber()
		const coreBal = (await core.balanceOf(token.address, core.address)).toNumber()
		assert.equal(coreBal-initialCoreBal, bid.tokenAmount.toNumber(), 'core balance increased by bid tokenAmount')
		assert.equal(initialCoreBal+initialAdvertiserBal, advertiserBal+coreBal, 'no inflation')

		// State has changed
		assert.equal((await core.getBidState(hash)).toNumber(), BidState.Active, 'bid state is active')
		//console.log(receipt)
	})



	it('commitmentFinalize', async function() {
		const commitment = commitment1
		const publisher = commitment.publisher
		const vote = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const hash = commitment.voteHash(vote)
		const sig1 = splitSig(await ethSign(accounts[0], hash))
		const sig2 = splitSig(await ethSign(accounts[1], hash))
		const sig3 = splitSig(await ethSign(accounts[2], hash))

		// @TODO: won't work if the vote is different
		const balBefore = await core.balanceOf(token.address, publisher)
		const receipt = await core.commitmentFinalize(commitment.values(), commitment.validators, commitment.validatorRewards, [sig1, sig2, sig3],vote)

		const balAfter = await core.balanceOf(token.address, publisher)
		const publisherValidatorReward = commitment.validators
			.map((x, i) => x==publisher ? commitment.validatorRewards[i].toNumber() : 0)
			.reduce((a, b) => a+b, 0)
		const allRewards = commitment.validatorRewards
			.map(x => x.toNumber())
			.reduce((a, b) => a+b, 0)
		const toIncreaseAmnt = commitment.tokenAmount.toNumber() + publisherValidatorReward - allRewards
		assert.equal(balBefore.toNumber() + toIncreaseAmnt, balAfter.toNumber(), 'balance increased by commitment tokenAmount')
		console.log(receipt)
	})

	// @TODO commitmentFinalize
	// @TODO commitmentTimeout
	// @TODO bidCancel

	// @TODO cannot withdraw more than we've deposited, even though the core has the balance

	// @TODO: ensure timeouts always work
	// ensure there is a max timeout
	// ensure we can't get into a istuation where we can't finalize (e.g. validator rewards are more than the total reward)
	// ensure calling finalize (everything for that matter, except deposit/withdraw) is always zero-sum on balances
	// @TODO to protect against math bugs, check common like: 1/2 validators voting (fail), 2/2 (success); 1/3 (f), 2/3 (s), 3/3 (s), etc.

	// UTILS
	function getTestValues() {
		const bid = new Bid({
			advertiser: accounts[2],
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
			bidId: bid.hash(libMock.address),
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
