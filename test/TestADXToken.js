const { providers, Contract } = require('ethers')
const { bigNumberify } = require('ethers').utils

const { expectEVMError, moveTime } = require('./')

const ADXToken = artifacts.require('ADXToken')
const MockToken = artifacts.require('./mocks/Token')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('ADXToken', function(accounts) {
	const userAddr = accounts[1]
	// @TODO contract
	const supplyCtrlAddr = accounts[2]

	let prevToken
	let adxToken

	before(async function() {
		const signer = web3Provider.getSigner(userAddr)

		const tokenWeb3 = await MockToken.new()
		prevToken = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const adxTokenWeb3 = await ADXToken.new(supplyCtrlAddr, prevToken.address)
		adxToken = new Contract(adxTokenWeb3.address, ADXToken._json.abi, signer)
	})

	it('swap previous tokens', async function() {
		await prevToken.setBalanceTo(userAddr, 10000)
		const receipt = await adxToken.swap(10000)
		assert.deepEqual(
			await adxToken.balanceOf(userAddr),
			bigNumberify('1000000000000000000'),
			'migrated amount is correct'
		)
		assert.equal(
			(await prevToken.balanceOf(userAddr)).toNumber(),
			0,
			'prev token amount is 0'
		)
		assert.equal(receipt.events.length, 2, '2 Transfer events')
		assert.ok(receipt.gasUsed.toNumber() < 100000, 'gas usage is OK')
	})
})
