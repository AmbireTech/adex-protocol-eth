/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
const { providers, Contract, Wallet } = require('ethers')
const { Interface } = require('ethers').utils

const AdExCore = artifacts.require('AdExCore')
const Identity = artifacts.require('Identity')
const IdentityFactory = artifacts.require('IdentityFactory')
const MockToken = artifacts.require('./mocks/Token')

const { sampleChannel } = require('./')
const { zeroFeeTx, getWithdrawData, ethSign } = require('./lib')
const { RoutineAuthorization, splitSig, Transaction } = require('../js')
const { getProxyDeployBytecode, getStorageSlotsFromArtifact } = require('../js/IdentityProxyDeploy')
const { solcModule } = require('../js/solc')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

// generate random address
function getRandomAddreses(size) {
	const addresses = []
	for (let i = 0; i < size; i += 1) {
		const wallet = Wallet.createRandom()
		addresses.push(wallet.address)
	}
	return addresses
}

function getRandomArbitrary(min, max) {
	return Math.random() * (max - min) + min
}

function logIdentityExecuteGasInfo(numberOfEarners, gasUsed, proof) {
	console.log('---------------------------- Gas Information -----------------------------------')
	console.log(
		`Identity.execute() GasUsed: ${gasUsed}, numberOfEarners: ${numberOfEarners}, proofSize: ${
			proof.length
		} `
	)
	console.log('---------------------------------------------------------------------------------')
}

const gasLimit = 1000000
const DAY_SECONDS = 24 * 60 * 60

contract('Simulate Bulk Withdrawal', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	const coreInterface = new Interface(AdExCore._json.abi)

	// The Identity contract factory
	let identityFactory
	// A dummy token
	let token
	// An instance of the AdExCore (OUTPACE) contract
	let coreAddr
	// an Identity contract that will be used as a base for all proxies
	let baseIdentityAddr
	// default RoutineAuthorization that's valid forever
	let defaultAuth
	// The Identity contract instance that will be used
	let id

	const validators = accounts.slice(0, 2)
	const relayerAddr = accounts[3]
	const userAcc = accounts[4]
	const validUntil = 4000000000

	before(async function() {
		const signer = web3Provider.getSigner(relayerAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const coreWeb3 = await AdExCore.deployed()
		coreAddr = coreWeb3.address

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
			outpace: coreAddr,
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

		await token.setBalanceTo(id.address, 10000)
	})

	it('routines: open a channel, execute: channelWithdraw', async function() {
		const minimumChannelEarners = 10
		const maximumChannelEarners = 20
		const rounds = 10

		for (let channelNonce = 0; channelNonce < rounds; channelNonce += 1) {
			const tokenAmnt = 500

			const fee = 20
			const blockTime = (await web3.eth.getBlock('latest')).timestamp
			const auth = new RoutineAuthorization({
				relayer: relayerAddr,
				outpace: coreAddr,
				validUntil: blockTime + 14 * DAY_SECONDS,
				feeTokenAddr: token.address,
				weeklyFeeAmount: fee
			})

			// Open a channel via the identity
			const channel = sampleChannel(
				validators,
				token.address,
				id.address,
				tokenAmnt,
				blockTime + 40 * DAY_SECONDS,
				channelNonce
			)
			const txns = [
				await zeroFeeTx(
					id.address,
					idInterface.functions.channelOpen.encode([coreAddr, channel.toSolidityTuple()]),
					0,
					id,
					token
				),
				await zeroFeeTx(
					id.address,
					idInterface.functions.setRoutineAuth.encode([auth.hashHex(), true]),
					1,
					id,
					token
				)
			]
			const sigs = await Promise.all(
				txns.map(async tx => splitSig(await ethSign(tx.hashHex(), userAcc)))
			)

			await (await id.execute(txns.map(x => x.toSolidityTuple()), sigs, { gasLimit })).wait()

			const numberOfEarners = Math.floor(
				getRandomArbitrary(minimumChannelEarners, maximumChannelEarners)
			)
			const amtPerAddress = Math.floor(tokenAmnt / (numberOfEarners * rounds))

			const earnerAddresses = [...getRandomAddreses(numberOfEarners), id.address]
			const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(
				channel,
				id.address,
				earnerAddresses,
				amtPerAddress,
				coreAddr
			)

			const channelWithdrawTx = new Transaction({
				identityContract: id.address,
				nonce: (await id.nonce()).toNumber(),
				feeTokenAddr: token.address,
				feeAmount: fee,
				to: coreAddr,
				data: coreInterface.functions.channelWithdraw.encode([
					channel.toSolidityTuple(),
					stateRoot,
					[vsig1, vsig2],
					proof,
					amtPerAddress
				])
			})

			const withdrawSigs = splitSig(await ethSign(channelWithdrawTx.hashHex(), userAcc))
			const withdrawRoutineReceipt = await (await id.execute(
				[channelWithdrawTx.toSolidityTuple()],
				[withdrawSigs],
				{ gasLimit }
			)).wait()

			logIdentityExecuteGasInfo(earnerAddresses.length, withdrawRoutineReceipt.gasUsed, proof)
		}
	})
})
