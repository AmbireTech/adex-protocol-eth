const promisify = require('util').promisify
const { providers, Contract } = require('ethers')

const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')
const MockLibs = artifacts.require('./mocks/Libs')

const { moveTime, sampleChannel, expectEVMError } = require('./')

const ethSign = promisify(web3.eth.sign.bind(web3))

const { ChannelState, Channel, MerkleTree, splitSig } = require('../js')

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
		assert.isTrue(
			await libMock.isValidSig(hash, userAcc, sig),
			'isValidSig returns true for the signer'
		)
		assert.isNotTrue(
			await libMock.isValidSig(hash, accounts[1], sig),
			'isValidSig returns true for a non-signer'
		)
	})

	it('channelOpen', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp

		const channelWrongCreator = sampleChannel(
			accounts,
			token.address,
			accounts[1],
			tokens,
			blockTime + 50,
			0
		)
		await expectEVMError(core.channelOpen(channelWrongCreator.toSolidityTuple()), 'INVALID_CREATOR')

		const channel = sampleChannel(accounts, token.address, userAcc, tokens, blockTime + 50, 0)
		const receipt = await (await core.channelOpen(channel.toSolidityTuple())).wait()
		const ev = receipt.events.find(x => x.event === 'LogChannelOpen')
		assert.ok(ev, 'has LogChannelOpen event')

		assert.equal(await token.balanceOf(userAcc), 0, 'account balance is 0')
		assert.equal(await token.balanceOf(core.address), tokens, 'contract balance is correct')

		assert.equal(ev.args.channelId, channel.hashHex(core.address), 'channel hash matches')
		assert.equal(
			await core.states(channel.hash(core.address)),
			ChannelState.Active,
			'channel state is correct'
		)

		await expectEVMError(core.channelOpen(channel.toSolidityTuple()), 'INVALID_STATE')
	})

	it('channelWithdrawExpired', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(accounts, token.address, userAcc, tokens, blockTime + 50, 1)

		await (await core.channelOpen(channel.toSolidityTuple())).wait()
		const initialBal = await token.balanceOf(userAcc)

		const channelWithdrawExpired = core.channelWithdrawExpired.bind(core, channel.toSolidityTuple())
		// Ensure we can't do this too early
		await expectEVMError(channelWithdrawExpired(), 'NOT_EXPIRED')

		// Ensure we can do this when the time comes
		await moveTime(web3, 100)
		const receipt = await (await channelWithdrawExpired()).wait()
		assert.ok(
			receipt.events.find(x => x.event === 'LogChannelWithdrawExpired'),
			'has LogChannelWihtdrawExpired event'
		)
		assert.equal(
			await core.states(channel.hash(core.address)),
			ChannelState.Expired,
			'channel state is correct'
		)
		assert.equal(
			await token.balanceOf(userAcc),
			initialBal.toNumber() + tokens,
			'funds are returned'
		)

		// cannot do it again
		await expectEVMError(channelWithdrawExpired(), 'INVALID_STATE')
	})

	it('channelWithdraw', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const totalDeposit = tokens
		const channel = sampleChannel(accounts, token.address, userAcc, totalDeposit, blockTime + 50, 2)
		const channelWithdraw = core.channelWithdraw.bind(core, channel.toSolidityTuple())
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		// Prepare the tree and sign the state root
		const userLeafAmnt = totalDeposit / 2
		const [stateRoot, validSigs, proof] = await balanceTreeToWithdrawArgs(
			channel,
			{ [userAcc]: userLeafAmnt },
			userAcc,
			userLeafAmnt
		)

		// Can't withdraw an amount that is not in the tree
		await expectEVMError(
			channelWithdraw(stateRoot, validSigs, proof, userLeafAmnt + 1),
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
		assert.ok(
			receipt.events.find(x => x.event === 'LogChannelWithdraw'),
			'has LogChannelWithdraw event'
		)
		assert.equal(await token.balanceOf(userAcc), userLeafAmnt, 'user has a proper token balance')

		const channelId = channel.hash(core.address)
		assert.equal(
			await core.withdrawn(channelId),
			userLeafAmnt,
			'channel has the right withdrawn value'
		)
		assert.equal(
			await core.withdrawnPerUser(channelId, userAcc),
			userLeafAmnt,
			'channel has right withdrawnPerUser'
		)

		// if we try with less, it won't work
		const decWithdrawArgs = await balanceTreeToWithdrawArgs(
			channel,
			{ [userAcc]: userLeafAmnt - 1 },
			userAcc,
			userLeafAmnt - 1
		)
		await expectEVMError(channelWithdraw(...decWithdrawArgs))

		// we can do it again, but it's not gonna give us more tokens
		const receipt2 = await (await validWithdraw()).wait()
		const withdrawEvent = receipt2.events.find(x => x.event === 'LogChannelWithdraw')
		assert.ok(withdrawEvent, 'has LogChannelWithdraw event')
		assert.equal(withdrawEvent.args.amount, 0, 'withdrawn amount is 0')
		assert.equal(
			await core.withdrawn(channelId),
			userLeafAmnt,
			'channel has the right withdrawn value'
		)

		// add more balances and withdraw; make sure that only the difference (to the last withdrawal) is withdrawn
		// also, test a tree that has more elements
		const incUserLeafAmnt = userLeafAmnt + 10
		const incWithdrawArgs = await balanceTreeToWithdrawArgs(
			channel,
			{
				[userAcc]: incUserLeafAmnt,
				[accounts[1]]: 10,
				[accounts[2]]: 10
			},
			userAcc,
			incUserLeafAmnt
		)
		const receipt3 = await (await channelWithdraw(...incWithdrawArgs)).wait()
		const incWithdrawEvent = receipt3.events.find(x => x.event === 'LogChannelWithdraw')
		assert.ok(incWithdrawEvent, 'has LogChannelWithdraw event')
		assert.equal(incWithdrawEvent.args.amount, 10, 'withdrawn amount is 10')
		assert.equal(
			await core.withdrawn(channelId),
			incUserLeafAmnt,
			'channel has the right withdrawn value'
		)
		assert.equal(await token.balanceOf(userAcc), incUserLeafAmnt, 'user has the right token amount')

		await moveTime(web3, 100)
		await expectEVMError(validWithdraw(), 'EXPIRED')

		// Now we withdrawExpired, and we can only get the rest
		const expiredReceipt = await (await core.channelWithdrawExpired(
			channel.toSolidityTuple()
		)).wait()
		const expiredEv = expiredReceipt.events.find(x => x.event === 'LogChannelWithdrawExpired')
		assert.equal(
			expiredEv.args.amount.toNumber() + incUserLeafAmnt,
			totalDeposit,
			'withdrawExpired returned the rest of the funds'
		)
		assert.equal(await token.balanceOf(userAcc), totalDeposit, 'totalDeposit is returned')
	})

	it('channelWithdraw: cannot withdraw more than the channel', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const totalDeposit = tokens
		const channel = sampleChannel(accounts, token.address, userAcc, totalDeposit, blockTime + 50, 3)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		const leafAmnt = totalDeposit + 1
		const [stateRoot, validSigs, proof] = await balanceTreeToWithdrawArgs(
			channel,
			{ [userAcc]: leafAmnt },
			userAcc,
			leafAmnt
		)
		await expectEVMError(
			core.channelWithdraw(channel.toSolidityTuple(), stateRoot, validSigs, proof, leafAmnt),
			'WITHDRAWING_MORE_THAN_CHANNEL'
		)
	})

	// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashToSignHex, sig1), 1000 times, takes ~6000ms
	// Bench: creating these: (elem1, elem2, elem3, tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms
	// Bench: creating these: (tree, proof, stateRoot, hashtoSignHex), 1000 times, takes ~300ms
	async function balanceTreeToWithdrawArgs(channel, balances, acc, amnt) {
		const elements = Object.entries(balances).map(([leafAcc, leafAmnt]) =>
			Channel.getBalanceLeaf(leafAcc, leafAmnt)
		)
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
