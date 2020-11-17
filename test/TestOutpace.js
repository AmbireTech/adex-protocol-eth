/* eslint-disable no-await-in-loop */
const { providers, Contract } = require('ethers')
const { Interface } = require('ethers').utils

const Outpace = artifacts.require('Outpace')

const Identity = artifacts.require('Identity')
const IdentityFactory = artifacts.require('IdentityFactory')
const MockToken = artifacts.require('./mocks/Token')

const {
	getWithdrawData,
	ethSign,
	getRandomAddresses,
	getRandomNumberWithinRange,
	V2Lib
} = require('./lib')
const {
	RoutineAuthorization,
	splitSig,
	Transaction,
	WithdrawnPerChannel,
	RoutineOps,
	ChannelState
} = require('../js')
const { getProxyDeployBytecode, getStorageSlotsFromArtifact } = require('../js/IdentityProxyDeploy')
const { solcModule } = require('../js/solc')
const {
	takeSnapshot,
	revertToSnapshot,
	moveTime,
	expectEVMError,
	sampleChannel
} = require('./index')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

const gasLimit = 1000000

contract('Outpace', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	const coreV2Interface = new Interface(Outpace._json.abi)

	// The Identity contract factory
	let identityFactory
	// A dummy token
	let token
	let core
	// An instance of the AdExCore (OUTPACE) contract
	let coreV2Addr
	// an Identity contract that will be used as a base for all proxies
	let baseIdentityAddr
	// default RoutineAuthorization that's valid forever
	let defaultAuth
	// The Identity contract instance that will be used
	let id

	// library for v2 functions
	let V2Library

	let snapshotId

	const validators = accounts.slice(0, 2)
	const relayerAddr = accounts[3]
	const userAcc = accounts[4]
	const userAccTokenAmount = 200
	const validUntil = 4000000000

	async function createExpiringChannels(channels, rounds) {
		for (let channelNonce = 0; channelNonce < rounds; channelNonce += 1) {
			const expiring = (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp + 3
			const { channel } = await V2Library.openV2Channel({
				channelNonce: channelNonce + 20000,
				validators,
				validUntil: expiring
			})
			channels.push(channel)
		}
		return channels
	}

	async function createChannels(channels, rounds) {
		for (let channelNonce = 0; channelNonce < rounds; channelNonce += 1) {
			const { channel } = await V2Library.openV2Channel({
				channelNonce: channelNonce + 10000,
				validators
			})
			channels.push(channel)
		}
		return channels
	}

	async function getChannelsWithdrawData({
		channels,
		tokenAmnt = 500,
		minimumChannelEarners = 10,
		maximumChannelEarners = 20,
		amountInTreeMultiplier = 1
	}) {
		const stateRoots = []
		const signatures = []
		const proofs = []
		const amountInTrees = []

		for (let i = 0; i < channels.length; i += 1) {
			const channel = channels[i]
			const numberOfEarners = Math.floor(
				getRandomNumberWithinRange(minimumChannelEarners, maximumChannelEarners)
			)
			const amtPerAddress = Math.floor(tokenAmnt / numberOfEarners)
			const earnerAddresses = [...getRandomAddresses(numberOfEarners), id.address]
			const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(
				channel,
				id.address,
				earnerAddresses,
				amtPerAddress * amountInTreeMultiplier,
				coreV2Addr
			)
			stateRoots.push(stateRoot)
			signatures.push([vsig1, vsig2])
			proofs.push(proof)
			amountInTrees.push(amtPerAddress * amountInTreeMultiplier)
		}
		return [stateRoots, signatures, proofs, amountInTrees]
	}

	async function executeBulkChannelWithdraw({
		fee,
		channels,
		stateRoots,
		signatures,
		proofs,
		amountInTrees,
		amountWithdrawnPerChannel
	}) {
		const channelBulkWithdrawTx = new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeAmount: fee,
			to: coreV2Addr,
			data: coreV2Interface.functions.channelWithdrawBulk.encode([
				[
					channels.map(channel => channel.toSolidityTuple()),
					stateRoots,
					signatures,
					proofs,
					amountInTrees
				],
				amountWithdrawnPerChannel
			])
		})

		const withdrawSigs = splitSig(await ethSign(channelBulkWithdrawTx.hashHex(), userAcc))
		const withdrawRoutineReceipt = await (await id.execute(
			[channelBulkWithdrawTx.toSolidityTuple()],
			[withdrawSigs],
			{ gasLimit }
		)).wait()

		return withdrawRoutineReceipt
	}

	before(async function() {
		const signer = web3Provider.getSigner(relayerAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)

		const corev2 = await Outpace.deployed()
		coreV2Addr = corev2.address
		core = new Contract(coreV2Addr, Outpace._json.abi, signer)

		// This IdentityFactory is used to test counterfactual deployment
		const idFactoryWeb3 = await IdentityFactory.new({ from: relayerAddr })
		identityFactory = new Contract(idFactoryWeb3.address, IdentityFactory._json.abi, signer)

		// deploy an Identity
		const idWeb3 = await Identity.new([], [])
		baseIdentityAddr = idWeb3.address

		// We use this default RoutineAuthorization
		// for various tests
		defaultAuth = new RoutineAuthorization({
			relayer: relayerAddr,
			outpace: coreV2Addr,
			validUntil,
			feeTokenAddr: token.address,
			weeklyFeeAmount: 0
		})
		const bytecode = getProxyDeployBytecode(
			baseIdentityAddr,
			[[userAcc, 2]],
			{
				routineAuthorizations: [defaultAuth.hash()],
				...getStorageSlotsFromArtifact(Identity)
			},
			solcModule
		)
		const receipt = await (await identityFactory.deploy(bytecode, 0, { gasLimit })).wait()
		const deployedEv = receipt.events.find(x => x.event === 'LogDeployed')
		id = new Contract(deployedEv.args.addr, Identity._json.abi, signer)

		await token.setBalanceTo(id.address, 100000000000)

		V2Library = new V2Lib({
			coreV2Addr,
			relayerAddr,
			userAcc,
			gasLimit,
			id,
			token,
			idInterface
		})
	})

	beforeEach(async function() {
		snapshotId = await takeSnapshot(web3)
		await token.setBalanceTo(userAcc, userAccTokenAmount)
	})

	// eslint-disable-next-line no-undef
	afterEach(async function() {
		await revertToSnapshot(web3, snapshotId)
	})

	it('channelOpen', async function() {
		const signer = web3Provider.getSigner(userAcc)
		// eslint-disable-next-line no-shadow
		const core = new Contract(coreV2Addr, Outpace._json.abi, signer)

		const blockTime = (await web3.eth.getBlock('latest')).timestamp

		const channelWrongCreator = sampleChannel(
			accounts,
			token.address,
			accounts[1],
			userAccTokenAmount,
			blockTime + 50,
			0
		)
		await expectEVMError(core.channelOpen(channelWrongCreator.toSolidityTuple()), 'INVALID_CREATOR')

		const channel = sampleChannel(
			accounts,
			token.address,
			userAcc,
			userAccTokenAmount,
			blockTime + 50,
			0
		)
		const receipt = await (await core.channelOpen(channel.toSolidityTuple())).wait()
		const ev = receipt.events.find(x => x.event === 'LogChannelOpen')
		assert.ok(ev, 'has LogChannelOpen event')

		assert.equal(await token.balanceOf(userAcc), 0, 'account balance is 0')
		assert.equal(
			await token.balanceOf(core.address),
			userAccTokenAmount,
			'contract balance is correct'
		)

		assert.equal(ev.args.channelId, channel.hashHex(core.address), 'channel hash matches')
		assert.equal(
			await core.states(channel.hash(core.address)),
			ChannelState.Active,
			'channel state is correct'
		)

		await expectEVMError(core.channelOpen(channel.toSolidityTuple()), 'INVALID_STATE')
	})

	it('channelWithdrawExpired', async function() {
		const signer = web3Provider.getSigner(userAcc)
		// eslint-disable-next-line no-shadow
		const core = new Contract(coreV2Addr, Outpace._json.abi, signer)
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(
			accounts,
			token.address,
			userAcc,
			userAccTokenAmount,
			blockTime + 50,
			1
		)

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
			initialBal.toNumber() + userAccTokenAmount,
			'funds are returned'
		)

		// cannot do it again
		await expectEVMError(channelWithdrawExpired(), 'INVALID_STATE')
	})

	it('channelWithdraw: cannot withdraw more than the channel', async function() {
		// eslint-disable-next-line no-shadow
		const core = new Contract(coreV2Addr, Outpace._json.abi, web3Provider.getSigner(userAcc))
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const totalDeposit = userAccTokenAmount
		const channel = sampleChannel(accounts, token.address, userAcc, totalDeposit, blockTime + 50, 3)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		const leafAmnt = totalDeposit + 1
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(
			channel,
			userAcc,
			[userAcc],
			leafAmnt,
			coreV2Addr
		)
		await expectEVMError(
			core.channelWithdrawBulk(
				[[channel.toSolidityTuple()], [stateRoot], [[vsig1, vsig2]], [proof], [leafAmnt]],
				[]
			),
			'WITHDRAWING_MORE_THAN_CHANNEL'
		)
	})

	it('channelBulkWithdraw', async function() {
		const channels = []
		let amountWithdrawnPerChannel = []
		let stateRoots
		let signatures
		let proofs
		let amountInTrees = []

		await createChannels(channels, 10)

		const fee = 20
		await V2Library.setV2RoutineAuth({ fee })

		const prevIdentityBalance = await token.balanceOf(id.address)

		async function performBulkWithdrawal(amountInTreeMultiplier = 1) {
			;[stateRoots, signatures, proofs, amountInTrees] = await getChannelsWithdrawData({
				channels,
				amountInTreeMultiplier
			})
			await executeBulkChannelWithdraw({
				fee,
				channels,
				stateRoots,
				signatures,
				proofs,
				amountInTrees,
				amountWithdrawnPerChannel
			})
			const withdrawnPerChannel = new WithdrawnPerChannel(channels, amountInTrees)

			// call the outpace contract to the user balance merkle root
			const onChainRoot = (await core.withdrawnPerUser(id.address)).toString('hex')

			assert.equal(
				withdrawnPerChannel.computeMerkleRootHex(id.address),
				onChainRoot,
				'should have equal merkle root hashes'
			)

			// check balance
			// minus relayer fee
			const expectedBalance =
				prevIdentityBalance.toNumber() +
				amountInTrees.reduce((a, b) => a + b, 0) -
				fee * amountInTreeMultiplier
			const currentIDBalance = (await token.balanceOf(id.address)).toNumber()

			assert.equal(
				expectedBalance,
				currentIDBalance,
				'should have the correct amount of withdrawn token'
			)
			amountWithdrawnPerChannel = withdrawnPerChannel.toSolidityTuple(coreV2Addr)
		}

		const firstWithdrawal = performBulkWithdrawal.bind(null, 1)
		const secondWithdrawalWithIncreasedAmount = performBulkWithdrawal.bind(null, 2)

		await firstWithdrawal()
		await secondWithdrawalWithIncreasedAmount()

		// ensure user balance didn't change

		// invalid amountWithdrawnPerChannel
		await expectEVMError(
			executeBulkChannelWithdraw({
				fee,
				channels,
				stateRoots,
				signatures,
				proofs,
				amountInTrees,
				amountWithdrawnPerChannel: []
			}),
			'INVALID_WITHDRAW_DATA'
		)

		// invalid balance leaf
		await expectEVMError(
			executeBulkChannelWithdraw({
				fee,
				channels,
				stateRoots,
				signatures,
				proofs,
				amountInTrees: [amountInTrees[0] * 2, ...amountInTrees.slice(1, amountInTrees.length)],
				amountWithdrawnPerChannel
			}),
			'BALANCELEAF_NOT_FOUND'
		)

		// Can't withdraw w/o valid signatures
		await expectEVMError(
			executeBulkChannelWithdraw({
				fee,
				channels,
				stateRoots,
				signatures: [
					[signatures[0][0], signatures[0][0]],
					...signatures.slice(1, signatures.length)
				],
				proofs,
				amountInTrees,
				amountWithdrawnPerChannel
			}),
			'NOT_SIGNED_BY_VALIDATORS'
		)
	})

	it('channelBulkWithdraw - should prune expired channels', async function() {
		const channels = []
		const amountWithdrawnPerChannel = []

		await createExpiringChannels(channels, 5)
		await createChannels(channels, 5)

		const [stateRoots, signatures, proofs, amountInTrees] = await getChannelsWithdrawData({
			channels
		})
		const fee = 20
		await V2Library.setV2RoutineAuth({ fee })

		await executeBulkChannelWithdraw({
			fee,
			channels,
			stateRoots,
			signatures,
			proofs,
			amountInTrees,
			amountWithdrawnPerChannel
		})

		await moveTime(web3, 10)

		const expiredChannels = channels.slice(0, 5)
		// make a channel expired onchain by calling `channelWithdrawExpired()`
		for (let i = 0; i < expiredChannels.length; i += 1) {
			const channel = expiredChannels[i]
			const executeRoutines = id.executeRoutines.bind(id, defaultAuth.toSolidityTuple())
			const withdrawExpiredOp = RoutineOps.channelWithdrawExpired([channel.toSolidityTuple()])
			await executeRoutines([withdrawExpiredOp], { gasLimit })
		}

		const currentWithdrawnPerChannel = new WithdrawnPerChannel(channels, amountInTrees)

		// execute channel withdraw on non-expired
		// channels to update withdrawnPerUser merkle root
		const nonExpiredChannels = channels.slice(5, 9)
		await executeBulkChannelWithdraw({
			fee,
			channels: nonExpiredChannels,
			stateRoots: stateRoots.slice(5, 9),
			signatures: signatures.slice(5, 9),
			proofs: proofs.slice(5, 9),
			amountInTrees: amountInTrees.slice(5, 9),
			amountWithdrawnPerChannel: currentWithdrawnPerChannel.toSolidityTuple(coreV2Addr)
		})

		const updatedWithdrawnPerChannelRoot = new WithdrawnPerChannel(
			nonExpiredChannels,
			amountInTrees.slice(5, 9)
		).computeMerkleRootHex(id.address)

		const onChainRoot = (await core.withdrawnPerUser(id.address)).toString('hex')

		assert.equal(
			updatedWithdrawnPerChannelRoot,
			onChainRoot,
			'should have equal merkle root hashes'
		)
	})
})
