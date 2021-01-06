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
		await expectEVMError(stakingWithSlasher.slash(poolId, (11 ** 18).toString(10)), 'PTS_TOO_HIGH')
	})

	it('open a bond, unbond it', async function() {
		const poolId = '0x0202020202020202020202020202020202020202020202020202020202020203'
		const bondAmount = 120000000
		let gasUsage = 0

		const bond = [bondAmount, poolId, 0]

		// slash the pool beforehand to see if math is fine
		await stakingWithSlasher.slash(poolId, 50000000000000, { gasLimit })

		// insufficient funds
		await expectEVMError(staking.addBond(bond), 'INSUFFICIENT_FUNDS')
		// bond does not exist
		await expectEVMError(staking.requestUnbond(bond), 'BOND_NOT_ACTIVE')

		await token.setBalanceTo(userAddr, bondAmount)

		const receipt = await (await staking.addBond(bond, { gasLimit })).wait()
		gasUsage += receipt.gasUsed.toNumber()

		// assert that the amounts are expected
		// assert.equal(await staking.totalFunds(poolId), bondAmount, 'totalFunds is correct')
		assert.equal(
			(await staking.getWithdrawAmount(userAddr, bond)).toNumber(),
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
		const burnAddr = '0xaDbeEF0000000000000000000000000000000000'
		const poolId = '0x0202020202020202020202020202020202020202020202020202020202222222'
		const sum = (a, b) => a + b

		// the max slash pts are 10**18
		// so we will slash it 3 times, all with 5% (10**18*0.05, and then multiplying that by 0.95)
		const slashes = ['50000000000000000', '47500000000000000', '45125000000000000']
		// since those bonds are by the same sender, they need to have different amounts so that they
		// are understood as different bonds (bondId is derived from the amount/poolId)
		const bonds = [
			// this one will suffer 1 slash cause it will be unbonded after the first one
			[133000000, poolId, 0],
			// this one would suffer all 3 slashes
			[120000000, poolId, 0],
			// this one will suffer 2 slashes
			[230000000, poolId, 0],
			// this one will suffer 1 slash
			[130000000, poolId, 0],
			// this one will suffer 0 slashes
			[399000000, poolId, 0]
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
		await token.setBalanceTo(userAddr, totalAmount)

		// the first bond will be unbonded immediately, and withdrawn after the second slash
		await staking.addBond(bonds[0], { gasLimit })
		await staking.requestUnbond(bonds[0], { gasLimit })

		await staking.addBond(bonds[1], { gasLimit })
		await stakingWithSlasher.slash(poolId, slashes[0], { gasLimit })

		// now we will take out bonds[0]
		await moveTime(web3, DAY_SECONDS * 31)
		assert.equal(
			await staking.getWithdrawAmount(userAddr, bonds[0]),
			bondsExpected[0],
			'getWithdrawAmount is correct'
		)
		const unbondReceipt = await (await staking.unbond(bonds[0], { gasLimit })).wait()
		assert.equal(
			parseInt(unbondReceipt.events[0].data, 16),
			bondsExpected[0],
			'the amount withdrawn is correct'
		)
		assert.equal(await staking.getWithdrawAmount(userAddr, bonds[0]), 0, 'no more to withdraw')
		const remainingBonds = bonds.slice(1)
		const remainingBondsExpected = bondsExpected.slice(1)

		// continue as planned
		await staking.addBond(bonds[2], { gasLimit })
		await stakingWithSlasher.slash(poolId, slashes[1], { gasLimit })
		await staking.addBond(bonds[3], { gasLimit })
		await stakingWithSlasher.slash(poolId, slashes[2], { gasLimit })
		await staking.addBond(bonds[4], { gasLimit })

		const amounts = await Promise.all(
			remainingBonds.map(bond => staking.getWithdrawAmount(userAddr, bond))
		)
		assert.deepEqual(
			amounts.map(x => x.toNumber()),
			remainingBondsExpected,
			'amounts are as expected'
		)

		// unbond all bonds
		await Promise.all(remainingBonds.map(bond => staking.requestUnbond(bond, { gasLimit })))
		await moveTime(web3, DAY_SECONDS * 31)
		await Promise.all(remainingBonds.map(bond => staking.unbond(bond, { gasLimit })))

		// check if we've properly slashed and withdrawn
		const totalSlashed = bonds.map(bond => bond[0]).reduce(sum, 0) - bondsExpected.reduce(sum, 0)
		assert.equal(
			await token.balanceOf(userAddr),
			bondsExpected.reduce(sum, 0),
			'user amount is correct'
		)
		assert.equal(await token.balanceOf(burnAddr), totalSlashed, 'slashed amount is correct')
	})

	it('replace bond - can stake more', async function() {
		const poolId = '0x0202020202020202020202020202020202020202020202020202020202020215'
		const anotherPoolId = '0x0202020202020202020202020202020202020202020202020202020202020216'
		const bondAmount = 120000000
		const addedOnReplaceAmount = 100000000
		const bond = [bondAmount, poolId, 0]
		const bondReplacement = [bondAmount + addedOnReplaceAmount, poolId, 0]

		await token.setBalanceTo(userAddr, bondAmount + addedOnReplaceAmount)

		await staking.addBond(bond)
		await expectEVMError(staking.unbond(bond), 'BOND_NOT_UNLOCKED')

		// We can't unbond this bond but we can replace it with a larger one
		await expectEVMError(staking.unbond(bond), 'BOND_NOT_UNLOCKED')

		// We can't replace unless it's the same size or bigger and it's
		await expectEVMError(
			staking.replaceBond(bondReplacement, [bondAmount * 2, poolId, 0]),
			'BOND_NOT_ACTIVE'
		)
		await expectEVMError(staking.replaceBond(bond, [bondAmount / 2, poolId, 0]), 'NEW_BOND_SMALLER')
		await expectEVMError(
			staking.replaceBond(bond, [bondAmount, anotherPoolId, 0]),
			'POOL_ID_DIFFERENT'
		)

		// Now, replace the bond to add another 1090000000 token units
		const receipt = await (await staking.replaceBond(bond, bondReplacement)).wait()
		assert.ok(receipt.events.find(x => x.event === 'LogUnbonded'), 'has LogUnbonded')
		const logBond = receipt.events.find(x => x.event === 'LogBond')
		assert.ok(logBond, 'has LogBond')

		// Now after a slash, add another 15000 to the bond's withdraw amount, while still being less than the original bond.amount
		const addedAfterSlash = 15000
		await stakingWithSlasher.slash(poolId, '500000000000000000', { gasLimit })
		const currentBondAmount = await staking.getWithdrawAmount(userAddr, bondReplacement)
		assert.equal(currentBondAmount, (bondAmount + addedOnReplaceAmount) / 2, 'was slashed in half')
		// just an internal assurance that we're indeed testing this
		assert.ok(currentBondAmount.add(addedAfterSlash).lt(bondAmount + addedOnReplaceAmount))
		// Now replace the bond with one that adds addedAfterSlash
		await token.setBalanceTo(userAddr, addedAfterSlash)
		// use a different nonce for a change: should not be a problem
		const bondAfterSlash = [currentBondAmount.add(addedAfterSlash), poolId, Date.now()]
		await staking.replaceBond(bondReplacement, bondAfterSlash)

		// Finally, we can withdraw this bond
		await staking.requestUnbond(bondAfterSlash)
		await moveTime(web3, DAY_SECONDS * 31)
		await staking.unbond(bondAfterSlash)

		assert.deepEqual(
			await token.balanceOf(userAddr),
			bondAfterSlash[0],
			'user balance has been returned'
		)
	})

	it('replace bond - can rebond', async function() {
		const poolId = '0x0202020202020202020202020202020202020202020202020202020202020225'
		const bondAmount = 200000000
		const bond = [bondAmount, poolId, 0]
		await token.setBalanceTo(userAddr, bondAmount)
		await staking.addBond(bond)
		const receipt = await (await staking.requestUnbond(bond)).wait()
		const unbondRequestedEv = receipt.events[0]
		assert.equal(unbondRequestedEv.event, 'LogUnbondRequested')
		assert.ok(
			(await staking.bonds(unbondRequestedEv.args.bondId)).willUnlock.gt(0),
			'has willUnlock set'
		)

		// replace the bond with the same one - effectively rebonding
		const receiptReplace = await (await staking.replaceBond(bond, bond)).wait()
		assert.ok(
			receiptReplace.events.find(x => x.event === 'LogBond'),
			'has LogBond emitted, which will cause this bond to be counted again'
		)

		// after we rebond we preserve the same ID
		const bondState = await staking.bonds(unbondRequestedEv.args.bondId)
		assert.ok(bondState.active, 'bond is active')
		assert.ok(bondState.willUnlock.eq(0), 'does not have willUnlock set')
	})

	it('fully slash a pool', async function() {
		const poolId = '0x9992020202020202020202020202020202020202020202020202020299990203'
		const bond = [3000000, poolId, 0]

		await stakingWithSlasher.slash(poolId, (10 ** 18).toString(10), { gasLimit })

		await token.setBalanceTo(userAddr, bond[0])
		await expectEVMError(staking.addBond(bond), 'POOL_SLASHED')
	})
})
