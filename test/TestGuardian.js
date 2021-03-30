// const promisify = require('util').promisify
// const { providers, Contract } = require('ethers')
const { providers, Contract } = require('ethers')

const { expectEVMError } = require('./')

const Guardian = artifacts.require('Guardian')
const Outpace = artifacts.require('OUTPACE')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('Guardian', function(accounts) {
	let guardian

	const userAcc = accounts[0]
	const pool = accounts[4]

	before(async function() {
		const coreWeb3 = await Outpace.deployed()
		const guardianWeb3 = await Guardian.new(coreWeb3.address)

		const signer = web3Provider.getSigner(userAcc)
		guardian = new Contract(guardianWeb3.address, Guardian._json.abi, signer)
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

	// it('getRefund', async function() {
	// })
})
