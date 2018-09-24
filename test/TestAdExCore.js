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
})