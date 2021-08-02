// const OUTPACE = artifacts.require('OUTPACE')
const IdentityFactory = artifacts.require('IdentityFactory')
const Identity = artifacts.require('Identity')
const Zapper = artifacts.require('WalletZapper')

module.exports = async function(deployer) {
	await deployer.deploy(IdentityFactory)
	await deployer.deploy(Identity, [])
	// ethereum mainnet: https://docs.aave.com/developers/v/2.0/deployed-contracts/deployed-contracts
	/*
	await deployer.deploy(Zapper, '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', 0, [
		// uni v2
		'0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
		// uni v3
		'0xE592427A0AEce92De3Edee1F18E0157C05861564',
		// sushi
		'0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f'
	])
	*/

	/*
	const zapper = await Zapper.deployed()
	const tokens = [
		'0xdac17f958d2ee523a2206206994597c13d831ec7', // usdt
		'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // usdc
		'0xade00c28244d5ce17d72e40330b1c318cd12b7c3', // adx
		'0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', // wbtc
		'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // weth
		//'0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', // sushi
		//'0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // aave
	]
	for (let spender of [
		// uni v2
		//'0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
		// uni v3
		'0xE592427A0AEce92De3Edee1F18E0157C05861564',
	]) {
		for (let token of tokens) {
			console.log(token, spender)
			await zapper.approveMax(token, spender)
		}
	}
	*/
}
