const AdExCore = artifacts.require('AdExCore')

// @TODO: async/await

contract('AdExCore', function(accounts) {
	it('deploy', function() {
		// console.log(accounts)
		return AdExCore.deployed()
		.then(function(instance) {
			// console.log(instance)
		})
	})

	// @TODO: ensure timeouts always work
	// ensure there is a max timeout
	// ensure we can't get into a istuation where we can't finalize (e.g. validator rewards are more than the total reward)
	// ensure calling finalize (everything for that matter, except deposit/withdraw) is always zero-sum on balances
})