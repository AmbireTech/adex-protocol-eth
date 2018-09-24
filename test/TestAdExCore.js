const AdExCore = artifacts.require('AdExCore')

contract('AdExCore', function(accounts) {
	it('deploy', async function() {
		// console.log(accounts)
		const instance = await AdExCore.deployed()
		

	})

	// @TODO: ensure timeouts always work
	// ensure there is a max timeout
	// ensure we can't get into a istuation where we can't finalize (e.g. validator rewards are more than the total reward)
	// ensure calling finalize (everything for that matter, except deposit/withdraw) is always zero-sum on balances
})