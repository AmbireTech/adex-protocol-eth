const { providers, Contract } = require('ethers')
const { bigNumberify, parseUnits } = require('ethers').utils

const { moveTime, expectEVMError } = require('./')

const MockToken = artifacts.require('./mocks/Token')
const ADXToken = artifacts.require('ADXToken')
const ADXSupplyController = artifacts.require('ADXSupplyController')
const LoyaltyPool = artifacts.require('LoyaltyPoolToken')

// const formatADX = v => formatUnits(v, 18)
const parseADX = v => parseUnits(v, 18)

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
		// 10 ADX
		const legacyAmountToMint = bigNumberify('100000')
		await prevToken.setBalanceTo(userAddr, legacyAmountToMint)
		await adxToken.swap(legacyAmountToMint)

		// 3.5 ADX
		const amountToTest = parseADX('3.5')

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
		// 0.3 ADX
		const incentive = parseADX('0.3')

		// @TODO try mint before enter
		// We need to re-enter first
		await adxToken.approve(loyaltyPool.address, amountToTest)
		await loyaltyPool.enter(amountToTest)
		const shares = await loyaltyPool.balanceOf(userAddr)
		// console.log('share val', formatADX(await loyaltyPool.shareValue()))
		// console.log('shares', formatADX(shares.toString(10)))
		await loyaltyPoolOwner.setIncentive(incentive)
		await moveTime(web3, 366 * 24 * 60 * 60)
		await adxToken.approve(loyaltyPool.address, amountToTest) // TEMP to move time
		// console.log('new share', formatADX(await loyaltyPool.shareValue()))
		// console.log('to mint', formatADX(await loyaltyPool.toMint()))
		await loyaltyPool.mintAndLeave(shares)
		const currentBal = await adxToken.balanceOf(userAddr)
		// console.log('current bal', formatADX(currentBal))
		assert.ok(currentBal.gt(postLeave.add(incentive)), 'incurred more than the annual incentive')
		// @TODO: dilluted stakes
	})
	// @TODO test max deposit
})