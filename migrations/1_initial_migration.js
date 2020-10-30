const Migrations = artifacts.require('./Migrations.sol')
const AdExCore = artifacts.require('./AdExCore.sol')
const Outpace = artifacts.require('./Outpace.sol')

module.exports = function(deployer) {
	deployer.deploy(AdExCore)
	deployer.deploy(Outpace)
	deployer.deploy(Migrations)
}
