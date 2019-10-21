const Migrations = artifacts.require('./Migrations.sol')
const AdExCore = artifacts.require('./AdExCore.sol')

module.exports = function(deployer) {
	deployer.deploy(AdExCore)
	deployer.deploy(Migrations)
}
