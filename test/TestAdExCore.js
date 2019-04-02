const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

const { moveTime, sampleChannel, expectEVMError } = require('./')
const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { ChannelState, Channel, MerkleTree, splitSig } = require('../js')
const { providers, Contract } = require('ethers')
const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('AdExCore', function(accounts) {
	let token
	let core
	let libMock

	const tokens = 2000
	const userAcc = accounts[0] 

	before(async function() {
		const tokenWeb3 = await MockToken.new()
		const coreWeb3 = await AdExCore.deployed()
		libMock = await MockLibs.new()
		// WARNING: all invokations to core/token will be from account[0]
		const signer = web3Provider.getSigner(userAcc)
		core = new Contract(coreWeb3.address, AdExCore._json.abi, signer)
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
	})
	beforeEach(async function() {
		await token.setBalanceTo(userAcc, tokens)
	})

	it('SignatureValidator', async function() {
		const hash = '0x0202020202020202020202020202020202020202020202020202020202020202'
		const sig = splitSig(await ethSign(hash, userAcc))
		assert.isTrue(await libMock.isValidSig(hash, userAcc, sig), 'isValidSig returns true for the signer')
		assert.isNotTrue(await libMock.isValidSig(hash, accounts[1], sig), 'isValidSig returns true for a non-signer')
	})

	it('channelOpen', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts, token.address, userAcc, tokens, blockTime+50, 0)
		const receipt = await (await core.channelOpen(channel.toSolidityTuple())).wait()
		const ev = receipt.events.find(x => x.event === 'LogChannelOpen') 
		assert.ok(ev, 'has LogChannelOpen event')

		assert.equal(await token.balanceOf(userAcc), 0, 'account balance is 0')
		assert.equal(await token.balanceOf(core.address), tokens, 'contract balance is correct')

		assert.equal(ev.args.channelId, channel.hashHex(core.address), 'channel hash matches')
		assert.equal(await core.states(channel.hash(core.address)), ChannelState.Active, 'channel state is correct')

		await expectEVMError(core.channelOpen(channel.toSolidityTuple()), 'INVALID_STATE')
	})

	it('channelWithdrawExpired', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts, token.address, userAcc, tokens, blockTime+50, 1)

		await (await core.channelOpen(channel.toSolidityTuple())).wait()
		const initialBal = await token.balanceOf(userAcc)

		// Ensure we can't do this too early
		await expectEVMError(core.channelWithdrawExpired(channel.toSolidityTuple()), 'NOT_EXPIRED')

		// Ensure we can do this when the time comes
		await moveTime(web3, 100)
		const receipt = await (await core.channelWithdrawExpired(channel.toSolidityTuple())).wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelWithdrawExpired'), 'has LogChannelWihtdrawExpired event')
		assert.equal(await core.states(channel.hash(core.address)), ChannelState.Expired, 'channel state is correct')
		assert.equal(await token.balanceOf(userAcc), initialBal.toNumber() + tokens, 'funds are returned')

		// cannot do it again
		await expectEVMError(core.channelWithdrawExpired(channel.toSolidityTuple()), 'INVALID_STATE')
	})

	it('channelWithdraw', async function() {
		// Prepare the tree and sign the state root
		const elem1 = Channel.getBalanceLeaf(userAcc, tokens/2)
		const elem2 = Channel.getBalanceLeaf(accounts[1], tokens/4)
		const elem3 = Channel.getBalanceLeaf(accounts[2], tokens/4)
		const tree = new MerkleTree([ elem1, elem2, elem3 ])
		const proof = tree.proof(elem1)

		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts, token.address, userAcc, tokens, blockTime+50, 2)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		const stateRoot = tree.getRoot()
		const hashToSignHex = channel.hashToSignHex(core.address, stateRoot)
		const sig1 = splitSig(await ethSign(hashToSignHex, userAcc))
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
		assert.equal(await token.balanceOf(userAcc), tokens/2, 'user has a proper token balance')

		const channelId = channel.hash(core.address)
		assert.equal(await core.withdrawn(channelId), tokens/2, 'channel has the right withdrawn value')
		assert.equal(await core.withdrawnPerUser(channelId, userAcc), tokens/2, 'channel hsa right withdrawnPerUser')
		// @TODO: test merkle tree with 1 element (no proof); merkle proof with 2 elements, and then with many

		// @TODO completely exhaust channel, use .withdrawn to ensure it's exhausted
		// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashToSignHex, sig1), 1000 times, takes ~6000ms
		// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms
		// Bench: creating these: (tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms

		// @TODO: if the balance leaf updates, the user can only withdraw the difference to the previous withdraw
		// @TODO if you use a balance leaf with less than the lsat withdraw you did, it will revert
		// @TODO: even if a state tree contains more than the total deposit of the channel, it can't be withdrawn (even if the contract has more tokens)
		// @TODO should the byzantine cases of channelWithdraw be in a separate test? (validators trying to attack)
		// @TODO can't withdraw more than the entire channel deposit, even if validators allow it
	})
})
