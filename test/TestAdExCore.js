const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')

contract('AdExCore', function(accounts) {
	let token
	let core

	before(async function() {
		token = await MockToken.new()
		core = await AdExCore.deployed()
	})

	it('deposit and withdraw', async function() {
		const acc = accounts[0]
		const minted = 666
		const deposited = 300
		const withdrawn = 200

		// NOTE: the mock token does not require allowance to be set
		await token.setBalanceTo(acc, minted)

		await core.deposit(token.address, deposited, { from: acc })
		assert.equal((await core.balanceOf(token.address, acc)).toNumber(), deposited, 'correct amount deposited')
		assert.equal((await token.balanceOf(acc)).toNumber(), minted-deposited, 'amount was taken off the token')

		await core.withdraw(token.address, withdrawn, { from: acc })
		assert.equal((await core.balanceOf(token.address, acc)).toNumber(), deposited-withdrawn, 'correct amount on core')
		assert.equal((await token.balanceOf(acc)).toNumber(), (minted-deposited)+withdrawn, 'amount is now on token')
	})

	// @TODO cannot withdraw more than we've deposited, even though the core has the balance

	// @TODO: ensure timeouts always work
	// ensure there is a max timeout
	// ensure we can't get into a istuation where we can't finalize (e.g. validator rewards are more than the total reward)
	// ensure calling finalize (everything for that matter, except deposit/withdraw) is always zero-sum on balances
	// @TODO to protect against math bugs, check common like: 1/2 validators voting (fail), 2/2 (success); 1/3 (f), 2/3 (s), 3/3 (s), etc.
})
