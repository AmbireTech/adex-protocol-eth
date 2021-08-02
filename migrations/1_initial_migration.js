// const OUTPACE = artifacts.require('OUTPACE')
const IdentityFactory = artifacts.require('IdentityFactory')
const Identity = artifacts.require('Identity')
const Zapper = artifacts.require('WalletZapper')

module.exports = async function(deployer) {
	// deployer.deploy(OUTPACE)
	await deployer.deploy(IdentityFactory)
	await deployer.deploy(Identity, [])
	// ethereum mainnet: https://docs.aave.com/developers/v/2.0/deployed-contracts/deployed-contracts
	await deployer.deploy(Zapper, '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', 0, [
		// uni v2
		'0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
		// uni v3
		'0xE592427A0AEce92De3Edee1F18E0157C05861564',
		// sushi
		'0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f'
	])
}
