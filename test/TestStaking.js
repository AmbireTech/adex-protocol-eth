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
		const poolId = '0x0202020202020202020202020202020202020202020202020202020202020203'
		await expectEVMError(staking.slash(poolId, 10), 'ONLY_SLASHER')
	})

	it('open a bond, unbond it', async function() {
		const poolId = '0x0202020202020202020202020202020202020202020202020202020202020203'
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

		// assert that the amounts are expected
		assert.equal(await staking.totalFunds(poolId), bondAmount, 'totalFunds is correct')
		assert.equal(
			(await staking.getWithdrawAmount(bond)).toNumber(),
			bondAmount,
			'bondAmount matches'
		)
		assert.equal((await token.balanceOf(userAddr)).toNumber(), 0, 'user has no tokens now')

		// we cannot bond twice
		await expectEVMError(staking.addBond(bond), 'BOND_ALREADY_ACTIVE')
		// we cannot unbond yet
		await expectEVMError(staking.unbond(bond), 'BOND_NOT_UNLOCKED')

		const receiptUnlock = await (await staking.requestUnbond(bond, { gasLimit })).wait()
		gasUsage += receiptUnlock.gasUsed.toNumber()

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

	it('bonds are slashed proportionally based on their bond/unbond time', async function() {
		const zeroAddr = '0x0000000000000000000000000000000000000000'
		const poolId = '0x0202020202020202020202020202020202020202020202020202020202222222'
		const sum = (a, b) => a + b

		// the max slash pts are 10**18
		// so we will slash it 3 times, all with 5% (10**18*0.05, and then multiplying that by 0.95)
		const slashes = ['50000000000000000', '47500000000000000', '45125000000000000']
		// since those bonds are by the same sender, they need to have different amounts so that they
		// are understood as different bonds (bondId is derived from the amount/poolId)
		const bonds = [
			// this one will suffer 1 slash cause it will be unbonded after the first one
			[133000000, poolId],
			// this one would suffer all 3 slashes
			[120000000, poolId],
			// this one will suffer 2 slashes
			[230000000, poolId],
			// this one will suffer 1 slash
			[130000000, poolId],
			// this one will suffer 0 slashes
			[399000000, poolId]
		]
		const bondsExpected = [
			bonds[0][0] * 0.95,
			bonds[1][0] * 0.95 * 0.95 * 0.95,
			bonds[2][0] * 0.95 * 0.95,
			bonds[3][0] * 0.95,
			bonds[4][0]
		]

		// prepare the token amount
		const totalAmount = bonds.map(bond => bond[0]).reduce(sum, 0)
		await Promise.all([
			token.setBalanceTo(userAddr, totalAmount),
			token.setBalanceTo(zeroAddr, 0)
		])

		// the first bond will be unbonded immediately, and withdrawn after the second slash
		await (await staking.addBond(bonds[0], { gasLimit })).wait()
		await (await staking.requestUnbond(bonds[0], { gasLimit })).wait()

		await (await staking.addBond(bonds[1], { gasLimit })).wait()
		await (await stakingWithSlasher.slash(poolId, slashes[0], { gasLimit })).wait()

		// now we will take out bonds[0]
		await moveTime(web3, DAY_SECONDS * 31)
		assert.equal(
			await staking.getWithdrawAmount(bonds[0]),
			bondsExpected[0],
			'getWithdrawAmount is correct'
		)
		const unbondReceipt = await (await staking.unbond(bonds[0], { gasLimit })).wait()
		assert.equal(
			parseInt(unbondReceipt.events[0].data, 16),
			bondsExpected[0],
			'the amount withdrawn is correct'
		)
		assert.equal(await staking.getWithdrawAmount(bonds[0]), 0, 'no more to withdraw')
		const remainingBonds = bonds.slice(1)
		const remainingBondsExpected = bondsExpected.slice(1)

		// continue as planned
		await (await staking.addBond(bonds[2], { gasLimit })).wait()
		await (await stakingWithSlasher.slash(poolId, slashes[1], { gasLimit })).wait()
		await (await staking.addBond(bonds[3], { gasLimit })).wait()
		await (await stakingWithSlasher.slash(poolId, slashes[2], { gasLimit })).wait()
		await (await staking.addBond(bonds[4], { gasLimit })).wait()

		const amounts = await Promise.all(remainingBonds.map(bond => staking.getWithdrawAmount(bond)))
		assert.deepEqual(
			amounts.map(x => x.toNumber()),
			remainingBondsExpected,
			'amounts are as expected'
		)
		assert.equal(
			await staking.totalFunds(poolId),
			remainingBondsExpected.reduce(sum, 0),
			'totalFunds is as expected'
		)

		const totalSlashed = bonds.map(bond => bond[0]).reduce(sum, 0) - bondsExpected.reduce(sum, 0)
		assert.equal(await token.balanceOf(zeroAddr), totalSlashed, 'slashed amount is correct')
	})
})
