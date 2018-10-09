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
		// @TODO can't start if the advertiser does not have funds
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
		const receipt = await core.commitmentStart(bid.values(), bid.validators, bid.validatorRewards, sig, 0x0, { from: publisher })

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

		// Assert that we can't do this twice
		try {
			await core.commitmentStart(bid.values(), bid.validators, bid.validatorRewards, sig, 0x0, { from: publisher })
			assert.isOk('false', 'commitmentStart should not be callable twice with the same bid')
		} catch(e) {
			assert.isOk(e.message.match(/VM Exception while processing transaction: revert/), 'cannot commitmentStart twice')
		}

		// Calculate balance changes
		const advertiserBal = (await core.balanceOf(token.address, bid.advertiser)).toNumber()
		const coreBal = (await core.balanceOf(token.address, core.address)).toNumber()
		assert.equal(coreBal-initialCoreBal, bid.tokenAmount.toNumber(), 'core balance increased by bid tokenAmount')
		assert.equal(initialCoreBal+initialAdvertiserBal, advertiserBal+coreBal, 'no inflation')

		// State has changed
		assert.equal((await core.getBidState(hash)).toNumber(), BidState.Active, 'bid state is active')
		//console.log(receipt)
	})



	it('commitmentFinalize', async function() {
		// @TODO can't finalize if we are timed out
		const commitment = commitment1
		const publisher = commitment.publisher
		const vote = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const hash = commitment.voteHash(vote)
		const sig1 = splitSig(await ethSign(accounts[0], hash))
		const sig2 = splitSig(await ethSign(accounts[1], hash))
		const sig3 = splitSig(await ethSign(accounts[2], hash))

		// First, test that we should revert when calling with the wrong vote
		const wrongVote = '0x0000000000000000000000000000000000000000000000000000000000000000'
		try {
			await core.commitmentFinalize(commitment.values(), commitment.validators, commitment.validatorRewards, [sig1, sig2, sig3], wrongVote)
			assert.isOk(false, 'commitmentFinalize did not throw with wrongVote')
		} catch(e) {
			assert.isOk(e.message.match(/VM Exception while processing transaction: revert/), 'cannot vote with a different vote')
		}

		// cannnot time it out
		try {
			await core.commitmentTimeout(commitment.values(), commitment.validators, commitment.validatorRewards, { from: publisher })
			assert.isOk(false, 'commitmentTimeout succeeded too early')
		} catch(e) {
			assert.isOk(e.message.match(/VM Exception while processing transaction: revert/), 'cannot timeout that early')
		}

		// Finalize and test if balances moved correctly
		const balBefore = await core.balanceOf(token.address, publisher)
		const receipt = await core.commitmentFinalize(commitment.values(), commitment.validators, commitment.validatorRewards, [sig1, sig2, sig3], vote)

		const balAfter = await core.balanceOf(token.address, publisher)
		const sum = (a, b) => a+b
		const publisherValidatorReward = commitment.validators
			.map((x, i) => x==publisher ? commitment.validatorRewards[i].toNumber() : 0)
			.reduce(sum, 0)
		const allValidatorRewards = commitment.validatorRewards
			.map(x => x.toNumber())
			.reduce(sum, 0)
		// We are checking whether the publisher received the reward, and their validator reward (cause they're a validator)
		const toIncreaseAmnt = commitment.tokenAmount.toNumber() + publisherValidatorReward - allValidatorRewards
		assert.equal(balBefore.toNumber() + toIncreaseAmnt, balAfter.toNumber(), 'balance increased by commitment tokenAmount')
		// @TODO: test when the publisher is NOT a validator
		// test different cases etc
		const ev = receipt.logs.find(ev => ev.event === 'LogBidFinalize')
		assert.isOk(ev, 'LogBidFinalize emitted')
		assert.equal(ev.args.vote, vote, 'vote is the same')

		//console.log(receipt)
	})

	it('commitmentTimeout', async function() {
		const { bid } = getTestValues()
	
		// prepare balances
		await token.setBalanceTo(bid.advertiser, bid.tokenAmount.toNumber())
		await core.deposit(token.address, bid.tokenAmount.toNumber(), { from: bid.advertiser })
		
		// initial values
		const initialBal = await core.balanceOf(token.address, bid.advertiser)

		// start the commitment
		const hash = bid.hash(core.address)
		const sig = splitSig(await ethSign(bid.advertiser, hash))
		const publisher = accounts[0]
		const receiptStart = await core.commitmentStart(bid.values(), bid.validators, bid.validatorRewards, sig, 0x0, { from: publisher })
		const commitmentEv = receiptStart.logs.find(x => x.event === 'LogBidCommitment')

		// evaluate if started
		assert.ok(commitmentEv, 'has commitment event')
		assert.equal((await core.balanceOf(token.address, bid.advertiser)).toNumber(), initialBal.toNumber()-bid.tokenAmount, 'balance is all locked on the commitment')

		// construct the commitment
		const commitment = new Commitment({
			bidId: hash,
			tokenAddr: bid.tokenAddr,
			tokenAmount: bid.tokenAmount,
			validUntil: commitmentEv.args.validUntil.toNumber(),
			advertiser: bid.advertiser,
			publisher: publisher,
			validators: bid.validators,
			validatorRewards: bid.validatorRewards,
		})


		// too early to timeout
		try {
			await core.commitmentTimeout(commitment.values(), commitment.validators, commitment.validatorRewards, { from: publisher })
			assert.isOk(false, 'commitmentTimeout succeeded too early')
		} catch(e) {
			assert.isOk(e.message.match(/VM Exception while processing transaction: revert/), 'cannot timeout that early')
		}

		// move ahead in time
		await moveTime(web3, 2*24*60*60)

		// commitmentTimeout and assert success
		const receipt = await core.commitmentTimeout(commitment.values(), commitment.validators, commitment.validatorRewards, { from: publisher })
		const ev = receipt.logs.find(x => x.event === 'LogBidTimeout')

		assert.ok(ev, 'has timeout event')
		assert.equal((await core.balanceOf(token.address, commitment.advertiser)).toNumber(), initialBal.toNumber(), 'balance is as it started')
	})


	// @TODO: test finalize with many validators, e.g. 40
	// @TODO bidCancel
	// @TODO: on finalization, test if only the validators who signed get rewarded; NOTE: we have tested this manually by replcaing one of the sigs with 0x0

	// @TODO cannot withdraw more than we've deposited, even though the core has the balance

	// @TODO: ensure timeouts always work
	// ensure there is a max timeout in any case
	// ensure we can't get into a situation where we can't finalize (e.g. validator rewards are more than the total reward)
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
			nonce: Date.now()+Math.floor(Math.random() * 10000),
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

	function moveTime(web3, time) {
		return new Promise(function(resolve, reject) {
			web3.currentProvider.send({
				jsonrpc: '2.0',
				method: 'evm_increaseTime',
				params: [time],
				id: 0,
			}, (err, res) => err ? reject(err) : resolve(res))
		})
	}
})
