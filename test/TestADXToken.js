const { providers, Contract } = require('ethers')
const { bigNumberify } = require('ethers').utils

// const { expectEVMError, moveTime } = require('./')

const ADXToken = artifacts.require('ADXToken')
const MockToken = artifacts.require('./mocks/Token')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('ADXToken', function(accounts) {
	const userAddr = accounts[1]
	// @TODO contract
	const supplyCtrlAddr = accounts[2]
	const anotherUser = accounts[3]

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
		await prevToken.setBalanceTo(userAddr, 15000)
		const receipt = await (await adxToken.swap(10000)).wait()
		const expectedAmnt = bigNumberify('1000000000000000000')
		assert.deepEqual(
			await adxToken.balanceOf(userAddr),
			expectedAmnt,
			'migrated amount is correct'
		)
		assert.equal(
			(await prevToken.balanceOf(userAddr)).toNumber(),
			5000,
			'prev token amount is 5000'
		)
		assert.equal(receipt.events.length, 2, '2 Transfer events')
		assert.ok(receipt.gasUsed.toNumber() < 100000, 'gas usage is OK')

		assert.deepEqual(await adxToken.totalSupply(), expectedAmnt, 'total supply is reflected')

		await (await adxToken.swap(5000)).wait()
		assert.deepEqual(
			await adxToken.totalSupply(),
			bigNumberify('1500000000000000000'),
			'total supply is reflected'
		)
	})
	
	it('transfer some tokens', async function() {
		const transferredAmount = bigNumberify('550000000000000000')
		const receipt = await (await adxToken.transfer(anotherUser, transferredAmount)).wait()
		assert.deepEqual(
			await adxToken.balanceOf(anotherUser),
			transferredAmount,
			'transferredAmount amount is correct'
		)
		assert.equal(receipt.events.length, 1, '1 event')
		assert.equal(receipt.events[0].event, 'Transfer', 'event is a transfer')
		assert.deepEqual(receipt.events[0].args.amount, transferredAmount, 'transfer amount is OK')
		assert.ok(receipt.gasUsed.toNumber() < 56000, 'gas usage is OK')
	})

	// @TODO change supply controller
	// @TODO supply controller minting
	// @TODO flash loans
})
