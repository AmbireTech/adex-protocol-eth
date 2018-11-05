const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

const splitSig = require('../js/splitSig')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

// @TODO test some stuff, e.g. SignatureValidator, via the built-in web3; do not require ethers at all here, but require it in the Channel js lib

const { Channel, ChannelState } = require('../js/Channel')
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
		const channel = new Channel({
			creator: accounts[0],
			tokenAddr: token.address,
			tokenAmount: tokens,
			validUntil: Math.floor(Date.now()/1000)+50,
			validators: [accounts[0], accounts[1]],
			spec: new Buffer(32),
		})
		const tx = await core.channelOpen(channel.toSolidityTuple())
		const receipt = await tx.wait()
		const ev = receipt.events.find(x => x.event === 'LogChannelOpen') 
		assert.ok(ev, 'has LogChannelOpen event')

		assert.equal(await token.balanceOf(accounts[0]), 0, 'account balance is 0')
		assert.equal(await token.balanceOf(core.address), tokens, 'contract balance is correct')

		//assert.equal(ev.args.channelId, channel.hashHex(core.address), 'channel hash matches')
		//assert.equal(await core.getChannelState(channel.hash(core.address)), ChannelState.Active, 'channel state is correct')
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

	it('channelWithdraw', async function() {
		const tokens = 2000
		await token.setBalanceTo(accounts[0], tokens)

		// @TODO: merge that into the JS lib somehow
		const MerkleTree = require('../js/merkleTree')
		const { keccak256 } = require('js-sha3')
		const abi = require('ethereumjs-abi')
		const elem1 = Buffer.from(keccak256.arrayBuffer(abi.rawEncode(['address', 'uint'], [accounts[0], tokens/2])))
		const elem2 = Buffer.from(keccak256.arrayBuffer(abi.rawEncode(['address', 'uint'], [accounts[1], tokens/4])))
		const elem3 = Buffer.from(keccak256.arrayBuffer(abi.rawEncode(['address', 'uint'], [accounts[2], tokens/8])))
		const tree = new MerkleTree([ elem1, elem2, elem3 ])
		//console.log(tree)
		const proof = tree.proof(elem1)
		//console.log(tree.verify(proof, elem2)) //works; when we pass elem1 it returns false :)

		// @TODO: the way we choose the validUntil time is shit, cause we moved the EVM time ahead already; we should use the EVM time everywhere rather than Date.now()
		const channel = [accounts[0], token.address, tokens, Math.floor(Date.now()/1000)+5000, [accounts[0], accounts[1]], '0x0202020202020202020202020202020202020202020202020202020202020204']
		const tx = await core.channelOpen(channel)
		const receipt = await tx.wait()

		// @TODO: compute channelId by the JS lib
		const channelId = receipt.events.find(x => x.event === 'LogChannelOpen').args.channelId

		// @TODO: merge computing stateRoot, hsahToSign in the JS lib
		const stateRoot = tree.getRoot()
		const hashToSign = new Buffer(keccak256.arrayBuffer(abi.rawEncode(['bytes32', 'bytes32'], [channelId, stateRoot])))
		const hashToSignHex = '0x'+hashToSign.toString('hex')
		const sig1 = splitSig(await ethSign(hashToSignHex, accounts[0]))
		const sig2 = splitSig(await ethSign(hashToSignHex, accounts[1]))

		// @TODO: proof is an array of Buffer, so is it alright for the other things to be buffers as well?
		const receiptWithdraw = await (await core.channelWithdraw(channel, stateRoot, [sig1, sig2], proof, tokens/2)).wait()

		assert.ok(receiptWithdraw.events.find(x => x.event === 'LogChannelWithdraw'), 'has LogChannelWithdraw event')
		assert.equal(await token.balanceOf(accounts[0]), tokens/2, 'user has a proper token balance')
		// @TODO: test merkle tree with 1 element (no proof); merkle proof with 2 elements, and the nwith many

		// @TODO completely exhaust channel, use getWithdrawn to ensure it's exhausted (or have a JS lib convenience method)
		// @TODO can't withdraw w/o enough sigs
		// @TODO can't withdraw without a valid merkle proof: BALANCELEAF_NOT_FOUND
	})

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
