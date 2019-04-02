const { providers, Contract } = require('ethers')

const Registry = artifacts.require('Registry')

const { expectEVMError } = require('./')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('Registry', function(accounts) {
	const ownerAddr = accounts[0]
	let registry
	let registryUser

	before(async function() {
		const registryWeb3 = await Registry.new()
		registry = new Contract(
			registryWeb3.address,
			Registry._json.abi,
			web3Provider.getSigner(ownerAddr)
		)
		registryUser = new Contract(
			registry.address,
			Registry._json.abi,
			web3Provider.getSigner(accounts[2])
		)
	})

	it('whitelist', async function() {
		const validator = accounts[1]

		// Another user cannot invoke
		await expectEVMError(registryUser.setWhitelisted(validator, true), 'ONLY_OWNER')

		// shold be false to start with
		assert.equal(await registry.whitelisted(validator), false)
		// we can set it to true
		await (await registry.setWhitelisted(validator, true)).wait()
		assert.equal(await registry.whitelisted(validator), true)
		// we can set it to false
		await (await registry.setWhitelisted(validator, false)).wait()
		assert.equal(await registry.whitelisted(validator), false)
	})

	it('changing ownership', async function() {
		await expectEVMError(registryUser.changeOwner(accounts[2]), 'ONLY_OWNER')

		await (await registry.changeOwner(accounts[2])).wait()
		assert.equal(await registry.owner(), accounts[2], 'owner has updated')
		// since the owner has changed, the previous owner can no longer change owner
		await expectEVMError(registry.changeOwner(accounts[3]), 'ONLY_OWNER')
	})
})
