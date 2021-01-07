const Migrations = artifacts.require('./Migrations.sol')
const OUTPACE = artifacts.require('./OUTPACE.sol')

module.exports = function(deployer) {
	deployer.deploy(OUTPACE)
	deployer.deploy(Migrations)
}
