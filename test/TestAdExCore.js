const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

const splitSig = require('../js/splitSig')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

// @TODO test some stuff, e.g. SignatureValidator, via the built-in web3; do not require ethers at all here, but require it in the Channel js lib
//const { Bid, BidState } = require('../js/Bid')
//const Commitment = require('../js/Commitment').Commitment
const { providers, Contract } = require('ethers');
const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('AdExCore', function(accounts) {
	let token
	let core

	before(async function() {
		const tokenWeb3 = await MockToken.new()
		//const libMockWeb3 = await MockLibs.new()
		const coreWeb3 = await AdExCore.deployed()
		// @TODO: WARNING: all invokations to core/token will be from account[0]
		const signer = web3Provider.getSigner(accounts[0])
		core = new Contract(coreWeb3.address, AdExCore._json.abi, signer)
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
	})

	// @TODO beforeEvery, set token balance?

	it('channelOpen', async function() {
		const tokens = 2000
		await token.setBalanceTo(accounts[0], tokens)
		const channel = [accounts[0], token.address, tokens, Math.floor(Date.now()/1000)+50, [accounts[0], accounts[1]], '0x0202020202020202020202020202020202020202020202020202020202020202']
		const tx = await core.channelOpen(channel)
		const receipt = await tx.wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelOpen'), 'has LogChannelOpen event')

		assert.equal(await token.balanceOf(accounts[0]), 0, 'account balance is 0')
		assert.equal(await token.balanceOf(core.address), tokens, 'contract balance is correct')

		// @TODO state has updated
	})

	// @TODO hash match between this channel and the JS lib
	// @TODO: SignatureValidator test via the mock lib

	it('channelWithdrawExpired', async function() {
		const tokens = 2000
		await token.setBalanceTo(accounts[0], tokens)
		// @TODO: getSampleChannel or some helper? the js lib?
		const channel = [accounts[0], token.address, tokens, Math.floor(Date.now()/1000)+50, [accounts[0], accounts[1]], '0x0202020202020202020202020202020202020202020202020202020202020203']
		await (await core.channelOpen(channel)).wait()
		try {
			await (await core.channelWithdrawExpired(channel))
			assert.isOk(false, 'channelWithdrawExpired succeeded too early')
		} catch(e) {
			assert.isOk(e.message.match(/VM Exception while processing transaction: revert NOT_EXPIRED/), 'cannot timeout that early')
		}

		await moveTime(web3, 100)

		const receipt = await (await core.channelWithdrawExpired(channel)).wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelWithdrawExpired'), 'has LogChannelWihtdrawExpired event')
		// @TODO ensure can't withdraw after it's expired; maybe verify that we can BEFORE via gas estimations
		// @TODO check balances, etc.
	})

	/*
	it('channelWithdraw', async function() {
		// @TODO completely exhaust channel, use getWithdrawn to ensure it's exhausted (or have a JS lib convenience method)
	})
	*/

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
