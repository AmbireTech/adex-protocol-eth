const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { Channel, ChannelState, MerkleTree, splitSig } = require('../js')
const { providers, Contract } = require('ethers')
const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('AdExCore', function(accounts) {
	let token
	let core
	let libMock

	const tokens = 2000

	before(async function() {
		const tokenWeb3 = await MockToken.new()
		const coreWeb3 = await AdExCore.deployed()
		libMock = await MockLibs.new()
		// WARNING: all invokations to core/token will be from account[0]
		const signer = web3Provider.getSigner(accounts[0])
		core = new Contract(coreWeb3.address, AdExCore._json.abi, signer)
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
	})
	beforeEach(async function() {
		await token.setBalanceTo(accounts[0], tokens)
	})

	it('SignatureValidator', async function() {
		const hash = '0x0202020202020202020202020202020202020202020202020202020202020202'
		const sig = splitSig(await ethSign(hash, accounts[0]))
		assert.isTrue(await libMock.isValidSig(hash, accounts[0], sig), 'isValidSig returns true for the signer')
		assert.isNotTrue(await libMock.isValidSig(hash, accounts[1], sig), 'isValidSig returns true for a non-signer')
	})

	it('channelOpen', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts[0], tokens, blockTime+50, 0)
		const receipt = await (await core.channelOpen(channel.toSolidityTuple())).wait()
		const ev = receipt.events.find(x => x.event === 'LogChannelOpen') 
		assert.ok(ev, 'has LogChannelOpen event')

		assert.equal(await token.balanceOf(accounts[0]), 0, 'account balance is 0')
		assert.equal(await token.balanceOf(core.address), tokens, 'contract balance is correct')

		assert.equal(ev.args.channelId, channel.hashHex(core.address), 'channel hash matches')
		assert.equal(await core.states(channel.hash(core.address)), ChannelState.Active, 'channel state is correct')
	})

	it('channelWithdrawExpired', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts[0], tokens, blockTime+50, 1)

		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		// Ensure we can't do this too early
		await expectEVMError(core.channelWithdrawExpired(channel.toSolidityTuple()), 'NOT_EXPIRED')

		// Ensure we can do this when the time comes
		await moveTime(web3, 100)
		const receipt = await (await core.channelWithdrawExpired(channel.toSolidityTuple())).wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelWithdrawExpired'), 'has LogChannelWihtdrawExpired event')
		// @TODO ensure can't withdraw after it's expired; maybe verify that we can BEFORE via gas estimations
		// @TODO check balances, etc.
		assert.equal(await core.states(channel.hash(core.address)), ChannelState.Expired, 'channel state is correct')

		// @TODO can't do this twice
	})

	it('channelWithdraw', async function() {
		// Prepare the tree and sign the state root
		const elem1 = Channel.getBalanceLeaf(accounts[0], tokens/2)
		const elem2 = Channel.getBalanceLeaf(accounts[1], tokens/4)
		const elem3 = Channel.getBalanceLeaf(accounts[2], tokens/4)
		const tree = new MerkleTree([ elem1, elem2, elem3 ])
		const proof = tree.proof(elem1)

		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts[0], tokens, blockTime+50, 2)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		const stateRoot = tree.getRoot()
		const hashToSignHex = channel.hashToSignHex(core.address, stateRoot)
		const sig1 = splitSig(await ethSign(hashToSignHex, accounts[0]))
		const sig2 = splitSig(await ethSign(hashToSignHex, accounts[1]))

		// Can't withdraw an amount that is not in the tree
		await expectEVMError(
			core.channelWithdraw(channel.toSolidityTuple(), stateRoot, [sig1, sig2], proof, tokens),
			'BALANCELEAF_NOT_FOUND'
		)

		// Can't withdraw w/o valid signatures
		const invalidSigs = [sig1, sig1] // using sig1 for both values
		await expectEVMError(
			core.channelWithdraw(channel.toSolidityTuple(), stateRoot, invalidSigs, proof, tokens),
			'NOT_SIGNED_BY_VALIDATORS'
		)

		// Can withdraw with the proper values
		const tx = await core.channelWithdraw(channel.toSolidityTuple(), stateRoot, [sig1, sig2], proof, tokens/2)
		const receipt = await tx.wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelWithdraw'), 'has LogChannelWithdraw event')
		assert.equal(await token.balanceOf(accounts[0]), tokens/2, 'user has a proper token balance')

		const channelId = channel.hash(core.address)
		assert.equal(await core.withdrawn(channelId), tokens/2, 'channel has the right withdrawn value')
		assert.equal(await core.withdrawnPerUser(channelId, accounts[0]), tokens/2, 'channel hsa right withdrawnPerUser')
		// @TODO: test merkle tree with 1 element (no proof); merkle proof with 2 elements, and then with many

		// @TODO completely exhaust channel, use getWithdrawn to ensure it's exhausted (or have a JS lib convenience method)
		// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashToSignHex, sig1), 1000 times, takes ~6000ms
		// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms
		// Bench: creating these: (tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms

		// @TODO: if the balance leaf updates, the user can only withdraw the difference to the previous withdraw
		// @TODO if you use a balance leaf with less than the lsat withdraw you did, it will revert
		// @TODO: even if a state tree contains more than the total deposit of the channel, it can't be withdrawn (even if the contract has more tokens)
		// @TODO should the byzantine cases of channelWithdraw be in a separate test? (validators trying to attack)
		// @TODO can't withdraw more than the entire channel deposit, even if validators allow it
	})

	function sampleChannel(creator, amount, validUntil, nonce) {
		const spec = new Buffer(32)
		spec.writeUInt32BE(nonce)
		return new Channel({
			creator,
			tokenAddr: token.address,
			tokenAmount: amount,
			validUntil,
			validators: [accounts[0], accounts[1]],
			spec,
		})
	}
	async function expectEVMError(promise, errString) {
		try {
			await promise;
			assert.isOk(false, 'should have failed with '+errString)
		} catch(e) {
			assert.isOk(e.message.match(new RegExp('VM Exception while processing transaction: revert '+errString)), 'wrong error: '+e.message)
		}
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
