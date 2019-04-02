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

		const channelWithdrawExpired = core.channelWithdrawExpired.bind(core, channel.toSolidityTuple())
		// Ensure we can't do this too early
		await expectEVMError(channelWithdrawExpired(), 'NOT_EXPIRED')

		// Ensure we can do this when the time comes
		await moveTime(web3, 100)
		const receipt = await (await channelWithdrawExpired()).wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelWithdrawExpired'), 'has LogChannelWihtdrawExpired event')
		assert.equal(await core.states(channel.hash(core.address)), ChannelState.Expired, 'channel state is correct')
		assert.equal(await token.balanceOf(userAcc), initialBal.toNumber() + tokens, 'funds are returned')

		// cannot do it again
		await expectEVMError(channelWithdrawExpired(), 'INVALID_STATE')
	})

	it('channelWithdraw', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts, token.address, userAcc, tokens, blockTime+50, 2)
		const channelWithdraw = core.channelWithdraw.bind(core, channel.toSolidityTuple())
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		// Prepare the tree and sign the state root
		const userLeafAmnt = tokens/2
		const [stateRoot, validSigs, proof] = await balanceTreeToWithdrawArgs(
			channel,
			{ [userAcc]: userLeafAmnt },
			userAcc, userLeafAmnt
		)

		// Can't withdraw an amount that is not in the tree
		await expectEVMError(
			channelWithdraw(stateRoot, validSigs, proof, userLeafAmnt+1),
			'BALANCELEAF_NOT_FOUND'
		)

		// Can't withdraw w/o valid signatures
		const invalidSigs = [validSigs[0], validSigs[0]] // using sig1 for both values
		await expectEVMError(
			channelWithdraw(stateRoot, invalidSigs, proof, userLeafAmnt),
			'NOT_SIGNED_BY_VALIDATORS'
		)

		// Can withdraw with the proper values
		const validWithdraw = () => channelWithdraw(stateRoot, validSigs, proof, userLeafAmnt)
		const tx = await validWithdraw()
		const receipt = await tx.wait()
		assert.ok(receipt.events.find(x => x.event === 'LogChannelWithdraw'), 'has LogChannelWithdraw event')
		assert.equal(await token.balanceOf(userAcc), userLeafAmnt, 'user has a proper token balance')

		const channelId = channel.hash(core.address)
		assert.equal(await core.withdrawn(channelId), userLeafAmnt, 'channel has the right withdrawn value')
		assert.equal(await core.withdrawnPerUser(channelId, userAcc), userLeafAmnt, 'channel has right withdrawnPerUser')

		// if we try with less, it won't work
		// @TODO

		// we can do it again, but it's not gonna give us more tokens
		const receipt2 = await (await validWithdraw()).wait()
		const withdrawEvent = receipt2.events.find(x => x.event === 'LogChannelWithdraw')
		assert.ok(withdrawEvent, 'has LogChannelWithdraw event')
		assert.equal(withdrawEvent.args.amount, 0, 'withdrawn amount is 0')
		assert.equal(await core.withdrawn(channelId), userLeafAmnt, 'channel has the right withdrawn value')

		// @TODO: test merkle tree with 1 element (no proof); merkle proof with 2 elements, and then with many

		// @TODO completely exhaust channel, use .withdrawn to ensure it's exhausted
		// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashToSignHex, sig1), 1000 times, takes ~6000ms
		// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms
		// Bench: creating these: (tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms

		// @TODO: even if a state tree contains more than the total deposit of the channel, it can't be withdrawn (even if the contract has more tokens)
		// @TODO should the byzantine cases of channelWithdraw be in a separate test? (validators trying to attack)

		await moveTime(web3, 100)
		await expectEVMError(validWithdraw(), 'EXPIRED')
	})

	async function balanceTreeToWithdrawArgs(channel, balances, acc, amnt) {
		const elements = Object.entries(balances)
			.map(([ acc, amnt ]) => Channel.getBalanceLeaf(acc, amnt))
		const tree = new MerkleTree(elements)
		const elemToWithdraw = Channel.getBalanceLeaf(acc, amnt)
		const proof = tree.proof(elemToWithdraw)
		const stateRoot = tree.getRoot()
		const hashToSignHex = channel.hashToSignHex(core.address, stateRoot)
		const sig1 = splitSig(await ethSign(hashToSignHex, userAcc))
		const sig2 = splitSig(await ethSign(hashToSignHex, accounts[1]))
		return [stateRoot, [sig1, sig2], proof, amnt]
	}
})

