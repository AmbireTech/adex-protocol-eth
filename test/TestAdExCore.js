const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')

// @TODO: have this in a JS library too, hardcode the hash here
// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md
// @TODO: use eth-sig-util in the tests, so we can conform with what metamask does
// https://github.com/MetaMask/eth-sig-util/blob/master/index.js
// https://github.com/ethereumjs/ethereumjs-abi/blob/master/lib/index.js
const bidSchemaHash = '0xf05a6d38810408971c1e2a9cd015fefd95aaae6d0c1a25da4ed10c1ac77ebb64'
const commitmentSchemaHash = '0x8aa1fb0e671ad6f7d73ad552eff29b7b79186e0143b91e48a013151a34ae50dd'

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
})