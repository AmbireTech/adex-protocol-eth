// const promisify = require('util').promisify
// const { providers, Contract } = require('ethers')
const { providers, Contract } = require('ethers')
const { bigNumberify } = require('ethers').utils

const { expectEVMError } = require('./')

const Guardian = artifacts.require('Guardian')
const MockToken = artifacts.require('Token')
const Outpace = artifacts.require('OUTPACE')

const web3Provider = new providers.Web3Provider(web3.currentProvider)
const { moveTime, sampleChannel, takeSnapshot, revertToSnapshot } = require('./')
const { splitSig, Transaction, Withdraw } = require('../js')
const { zeroFeeTx, ethSign, getWithdrawData } = require('./lib')

contract('Guardian', function(accounts) {
	let token
	let core
	let guardian

	const defaultTokenAmount = 2000
	const userAcc = accounts[0]
	const leader = accounts[1]
	const follower = accounts[2]
	const user2 = accounts[3]
	const pool = accounts[4]

	before(async function() {
		const tokenWeb3 = await MockToken.new()
		const coreWeb3 = await Outpace.deployed()
		const guardianWeb3 = await Guardian.new(coreWeb3.address)

		const signer = web3Provider.getSigner(userAcc)
		core = new Contract(coreWeb3.address, Outpace._json.abi, signer)
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		guardian = new Contract(guardianWeb3.address, Guardian._json.abi, signer)
	})

	beforeEach(async function() {
		await token.setBalanceTo(userAcc, defaultTokenAmount)
	})

	it('registerPool', async function() {
		expectEVMError(guardian.registerPool(pool, 1000), 'REFUND_PROMILLES_BOUNDS')
		await guardian.registerPool(pool, 100)
		expectEVMError(guardian.registerPool(pool, 1000), 'STAKING_ALREADY_REGISTERED')
		// check
		assert.equal((await guardian.refundInterestPromilles(userAcc)).toNumber(), 100)
		assert.equal((await guardian.poolForValidator(userAcc)).toString(), pool)
	})

	it('setRefundPromilles', async function() {
		await guardian.setRefundPromilles(50)
	})

	it('getRefund', async function() {
		const channel = sampleChannel(leader, follower, userAcc, token.address, 0)

		await (await core.deposit(channel.toSolidityTuple(), userAcc, defaultTokenAmount)).wait()

		// Prepare the tree and sign the state root
		const userLeafAmnt = defaultTokenAmount / 2
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(
			channel,
			userAcc,
			[userAcc],
			userLeafAmnt,
			core.address
		)

		// valid withdraw
		const validWithdrawal = new Withdraw({
			channel,
			balanceTreeAmount: userLeafAmnt,
			stateRoot,
			sigLeader: vsig1,
			sigFollower: vsig2,
			proof
		})

		const validWithdrawReceipt = await (await core.withdraw(
			validWithdrawal.toSolidityTuple()
		)).wait()

        

	})
})
