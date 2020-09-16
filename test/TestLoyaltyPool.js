const { providers, Contract } = require('ethers')
const { bigNumberify } = require('ethers').utils

const { expectEVMError, setTime } = require('./')

const MockToken = artifacts.require('./mocks/Token')
const ADXToken = artifacts.require('ADXToken')
const ADXSupplyController = artifacts.require('ADXSupplyController')
const LoyaltyPool = artifacts.require('LoyaltyPoolToken')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('LoyaltyPool', function(accounts) {
	const userAddr = accounts[5]
	const governance = accounts[2]

	let adxToken
	let adxSupplyController
	let loyaltyPool

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
		const loyaltyWeb3 = await LoyaltyPool.new(adxToken.address, 0, maxADX)
		loyaltyPool = new Contract(loyaltyWeb3.address, LoyaltyPool._json.abi, signer)

		await adxSupplyController.setGovernance(loyaltyPool.address, 1)
	})

	it('enter and then leave', async function() {
		const amountToTest = bigNumberify('270000000000000')
		await prevToken.setBalanceTo(userAddr, amountToTest)
		await adxToken.swap(amountToTest)

		// enter the pool
		await adxToken.approve(loyaltyPool.address, amountToTest)
		await loyaltyPool.enter(amountToTest)

		// leave and test bal
		const preLeave = await adxToken.balanceOf(userAddr)
		await loyaltyPool.leave(amountToTest)
		const postLeave = await adxToken.balanceOf(userAddr)
		assert.deepEqual(postLeave.sub(preLeave), amountToTest, 'received the original amount')

		// @TODO: enter and leave with incentive
		// @TODO: dilluted users
		// set the incentive
	})

})
