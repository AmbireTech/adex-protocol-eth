const { providers, Contract } = require('ethers')
const promisify = require('util').promisify

const { expectEVMError, sampleChannel, moveTime } = require('./')
const { Channel, MerkleTree, splitSig } = require('../js')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

const EarningOracle = artifacts.require('EarningOracle')
const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')

const ethSign = promisify(web3.eth.sign.bind(web3))

contract('EarningOracle', function(accounts) {
	const userAddr = accounts[1]
	const publisher = accounts[2]
	const anotherPublisher = accounts[3]

	let earningOracle
	let core
	let coreAddr
	let token

	const tokenAmount = 200

	before(async function() {
		const signer = web3Provider.getSigner(userAddr)

		const coreWeb3 = await AdExCore.deployed()
		coreAddr = coreWeb3.address
		core = new Contract(coreWeb3.address, AdExCore._json.abi, signer)

		const earningOracleWeb3 = await EarningOracle.new(coreWeb3.address)
		earningOracle = new Contract(earningOracleWeb3.address, EarningOracle._json.abi, signer)

		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
	})

	beforeEach(async function() {
		await token.setBalanceTo(userAddr, tokenAmount)
	})

	it('should not bulkUpdate non expired channel', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp

		const channel = sampleChannel(
			accounts,
			token.address,
			userAddr,
			tokenAmount,
			blockTime + 100,
			0
		)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		await expectEVMError(
			earningOracle.bulkUpdate([channel.hashHex(core.address)], [userAddr]),
			'CHANNEL_NOT_EXPIRED'
		)
	})

	it('bulkUpdate', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp

		const channel = sampleChannel(accounts, token.address, userAddr, tokenAmount, blockTime + 10, 1)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		const withdrawAmount = tokenAmount / 10
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(
			channel,
			userAddr,
			[userAddr, publisher, anotherPublisher],
			withdrawAmount,
			coreAddr
		)

		await (await core.channelWithdraw(
			channel.toSolidityTuple(),
			stateRoot,
			[vsig1, vsig2],
			proof,
			withdrawAmount
		)).wait()

		await moveTime(web3, 20)

		await (await core.channelWithdrawExpired(channel.toSolidityTuple())).wait()
		// call bulk tally
		await (await earningOracle.bulkUpdate([channel.hashHex(coreAddr)], [userAddr])).wait()

		assert.equal(
			(await earningOracle.getTotalEarning(userAddr)).toNumber(),
			withdrawAmount,
			'expected to have equal withdraw amount'
		)

		await expectEVMError(
			earningOracle.bulkUpdate([channel.hashHex(coreAddr)], [userAddr]),
			'ALREADY_TALLIED'
		)
	})
})

async function getWithdrawData(channel, id, addresses, tokenAmnt, coreAddr) {
	const elems = addresses.map(addr => {
		return Channel.getBalanceLeaf(addr, tokenAmnt)
	})
	const idElem = Channel.getBalanceLeaf(id, tokenAmnt)
	const tree = new MerkleTree(elems)
	const proof = tree.proof(idElem)
	const stateRoot = tree.getRoot()
	const hashToSignHex = channel.hashToSignHex(coreAddr, stateRoot)
	const [sig1, sig2] = await Promise.all(channel.validators.map(v => ethSign(hashToSignHex, v)))
	return [stateRoot, splitSig(sig1), splitSig(sig2), proof]
}
