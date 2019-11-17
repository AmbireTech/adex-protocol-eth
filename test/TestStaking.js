const { providers, Contract } = require('ethers')

const Staking = artifacts.require('Staking')
const MockToken = artifacts.require('./mocks/Token')

const { expectEVMError, moveTime } = require('./')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

const DAY_SECONDS = 24 * 60 * 60
const gasLimit = 1000000

contract('Staking', function(accounts) {
	const userAddr = accounts[1]
	const slasherAddr = accounts[2]
	const poolId = '0x0202020202020202020202020202020202020202020202020202020202020203'
	let staking
	let stakingWithSlasher
	let token

	before(async function() {
		const signer = web3Provider.getSigner(userAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const stakingWeb3 = await Staking.new(tokenWeb3.address, slasherAddr)
		staking = new Contract(stakingWeb3.address, Staking._json.abi, signer)
		stakingWithSlasher = new Contract(
			stakingWeb3.address,
			Staking._json.abi,
			web3Provider.getSigner(slasherAddr)
		)
	})

	it('cannot slash', async function() {
		await expectEVMError(staking.slash(poolId, 10), 'ONLY_SLASHER')
	})

	it('open a bond, unbond it', async function() {
		const bondAmount = 120000000
		let gasUsage = 0

		const bond = [bondAmount, poolId]

		// slash the pool beforehand to see if math is fine
		await (await stakingWithSlasher.slash(poolId, 50000000000000, { gasLimit })).wait()

		// insufficient funds
		await expectEVMError(staking.addBond(bond), 'INSUFFICIENT_FUNDS')
		// bond does not exist
		await expectEVMError(staking.requestUnbond(bond), 'BOND_NOT_ACTIVE')

		await token.setBalanceTo(userAddr, bondAmount)

		const receipt = await (await staking.addBond(bond, { gasLimit })).wait()
		gasUsage += receipt.gasUsed.toNumber()

		// @TODO: check if bond exists
		assert.equal(
			(await staking.getWithdrawAmount(bond)).toNumber(),
			bondAmount,
			'bondAmount matches'
		)
		assert.equal((await token.balanceOf(userAddr)).toNumber(), 0, 'user has no tokens now')

		// we cannot unbond yet
		await expectEVMError(staking.unbond(bond), 'BOND_NOT_UNLOCKED')

		const receiptUnlock = await (await staking.requestUnbond(bond, { gasLimit })).wait()
		gasUsage += receiptUnlock.gasUsed.toNumber()

		// @TODO test slashing
		// 98%
		// await (await stakingWithSlasher.slash(poolId, '19999000000000000')).wait()

		// we still can't unbond yet
		await expectEVMError(staking.unbond(bond), 'BOND_NOT_UNLOCKED')

		// after this, we will finally be able to unbond
		await moveTime(web3, DAY_SECONDS * 31)

		const receiptUnbond = await (await staking.unbond(bond, { gasLimit })).wait()
		gasUsage += receiptUnbond.gasUsed.toNumber()

		assert.equal(
			(await token.balanceOf(userAddr)).toNumber(),
			bondAmount,
			'user has their bond amount returned'
		)
		assert.ok(gasUsage < 180000, 'gas usage is OK')
	})
})
