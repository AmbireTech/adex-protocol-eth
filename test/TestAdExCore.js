const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

//const { Bid, BidState } = require('../js/Bid')
//const Commitment = require('../js/Commitment').Commitment
const splitSig = require('../js/splitSig')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

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
		const tx = await core.channelOpen([accounts[0], token.address, tokens, 1543622400, [accounts[0],accounts[1]],"0x0202020202020202020202020202020202020202020202020202020202020202"])
		const receipt = await tx.wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelOpen'), 'has LogChannelOpen event')

		assert.equal(await token.balanceOf(accounts[0]), 0, 'account balance is 0')
		assert.equal(await token.balanceOf(core.address), tokens, 'contract balance is correct')
	})

	/*it('channelExpiredWithdraw', async function() {
	})

	it('channelWithdraw', async function() {
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
