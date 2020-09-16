const { providers, Contract } = require('ethers')
const { bigNumberify } = require('ethers').utils

const { moveTime, expectEVMError } = require('./')

const MockToken = artifacts.require('./mocks/Token')
const ADXToken = artifacts.require('ADXToken')
const ADXSupplyController = artifacts.require('ADXSupplyController')
const LoyaltyPool = artifacts.require('LoyaltyPoolToken')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('LoyaltyPool', function(accounts) {
	const userAddr = accounts[5]
	const governance = accounts[2]

	let prevToken
	let adxToken
	let adxSupplyController
	let loyaltyPool
	let loyaltyPoolOwner

	before(async function() {
		const signer = web3Provider.getSigner(userAddr)
		const signerWithGovernance = web3Provider.getSigner(governance)

		// prev token needed cause it's the only way to mint the new token
		const tokenWeb3 = await MockToken.new()
		prevToken = new Contract(tokenWeb3.address, MockToken._json.abi, signer)

		const adxSupplyControllerWeb3 = await ADXSupplyController.new({ from: governance })
		adxSupplyController = new Contract(
			adxSupplyControllerWeb3.address,
			ADXSupplyController._json.abi,
			signerWithGovernance
		)
		const adxTokenWeb3 = await ADXToken.new(adxSupplyController.address, prevToken.address)
		adxToken = new Contract(adxTokenWeb3.address, ADXToken._json.abi, signer)

		const maxADX = '150000000000000000000'
		const loyaltyWeb3 = await LoyaltyPool.new(adxToken.address, 0, maxADX, { from: governance })
		loyaltyPool = new Contract(loyaltyWeb3.address, LoyaltyPool._json.abi, signer)
		loyaltyPoolOwner = new Contract(
			loyaltyWeb3.address,
			LoyaltyPool._json.abi,
			signerWithGovernance
		)

		await adxSupplyController.setGovernance(loyaltyPool.address, 1)
	})

	it('permissioned methods', async function() {
		await expectEVMError(loyaltyPool.setOwner(userAddr), 'NOT_OWNER')
		await expectEVMError(loyaltyPool.setIncentive(100000), 'NOT_OWNER')
		await expectEVMError(loyaltyPool.setSymbol('STONKS'), 'NOT_OWNER')
	})

	it('enter and then leave', async function() {
		const amountToMint = bigNumberify('1000000000000000')
		await prevToken.setBalanceTo(userAddr, amountToMint)
		await adxToken.swap(amountToMint)

		const amountToTest = bigNumberify('270000000000000')

		// enter the pool
		await adxToken.approve(loyaltyPool.address, amountToTest)
		await loyaltyPool.enter(amountToTest)

		// leave and test bal
		const preLeave = await adxToken.balanceOf(userAddr)
		await loyaltyPool.leave(amountToTest)
		const postLeave = await adxToken.balanceOf(userAddr)
		assert.deepEqual(postLeave.sub(preLeave), amountToTest, 'received the original amount')

		// @TODO: Repeat the cycle with some additional ADX created first
		// Enter and leave with incentive
		const incentive = bigNumberify('5000')

		// @TODO try mint before enter
		await adxToken.approve(loyaltyPool.address, amountToTest)
		await loyaltyPool.enter(amountToTest)
		await loyaltyPoolOwner.setIncentive(incentive)
		await moveTime(web3, 366 * 24 * 60 * 60)
		// await loyaltyPool.mintAndLeave(amountToTest)
		// const currentBal = await adxToken.balanceOf(userAddr)
		// assert.ok(currentBal.gt(postLeave.add(incentive)), 'incurred more than the annual incentive')
		// console.log(currentBal)
		// @TODO: dilluted stakes
	})
})
