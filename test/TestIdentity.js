const Identity = artifacts.require('Identity')
const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')

const { Transaction, RoutineAuthorization, splitSig, getIdentityDeployData } = require('../js')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { providers, Contract, ContractFactory } = require('ethers')
const { Interface, randomBytes } = require('ethers').utils
const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('Identity', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	const coreInterface = new Interface(AdExCore._json.abi)
	let id
	let token
	let coreAddr

	const relayerAddr = accounts[3]
	const userAcc = accounts[4]

	before(async function() {
		const signer = web3Provider.getSigner(relayerAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const coreWeb3 = await AdExCore.deployed()
		const coreAddr = coreWeb3.address
		// deploy this with a 0 fee, cause w/o the counterfactual deployment we can't send tokens to the addr first
		const idWeb3 = await Identity.new(userAcc, 3, token.address, relayerAddr, 0)
		id = new Contract(idWeb3.address, Identity._json.abi, signer)
		await token.setBalanceTo(id.address, 10000)
	})

	it('deploy an Identity, counterfactually, and pay the fee', async function() {
		const feeAmnt = 250

		// Generating a deploy transaction
		const factory = new ContractFactory(Identity._json.abi, Identity._json.bytecode)
		const deployTx = factory.getDeployTransaction(
			// userAcc will have privilege 3 (everything)
			userAcc, 3,
			// deploy fee will be feeAmnt to relayerAddr
			token.address, relayerAddr, feeAmnt
		)
		const seed = randomBytes(64)
		const deployData = getIdentityDeployData(seed, deployTx)

		// set the balance so that we can pay out the fee when deploying
		await token.setBalanceTo(deployData.idContractAddr, 10000)

		// fund the deployer with ETH
		await web3.eth.sendTransaction({
			from: relayerAddr,
			to: deployData.tx.from,
			value: deployData.tx.gasLimit * deployData.tx.gasPrice,
		})

		// deploy the contract, whcih should also pay out the fee
		const deployReceipt = await web3.eth.sendSignedTransaction(deployData.txRaw)
		assert.equal(deployData.tx.from.toLowerCase(), deployReceipt.from.toLowerCase(), 'from matches')
		assert.equal(deployData.idContractAddr.toLowerCase(), deployReceipt.contractAddress.toLowerCase(), 'contract address matches')
		// check if deploy fee is paid out
		assert.equal(await token.balanceOf(relayerAddr), feeAmnt, 'fee is paid out')
		// this is what we should do if we want to instantiate an ethers Contract
		//id = new Contract(deployData.idContractAddr, Identity._json.abi, signer)
	})

	it('relay a tx', async function() {
		assert.equal(await id.privileges(userAcc), 3, 'privilege is 3 to start with')

		const initialBal = await token.balanceOf(relayerAddr)
		// @TODO: multiple transactions
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: 0,
			feeTokenAddr: token.address,
			feeTokenAmount: 25,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4]),
		})
		const hash = relayerTx.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))

		// @TODO: set gasLimit manually
		const receipt = await (await id.execute([relayerTx.toSolidityTuple()], [sig])).wait()

		assert.equal(await id.privileges(userAcc), 4, 'privilege level changed')
		assert.equal(await token.balanceOf(relayerAddr), initialBal.toNumber() + relayerTx.feeTokenAmount.toNumber(), 'relayer has received the tx fee')
		//console.log(receipt.gasUsed.toString(10))
		// @TODO test if setAddrPrivilege CANNOT be invoked from anyone else
		// @TODO test wrong nonce
		// @TODO test a few consencutive transactions
		// @TODO test wrong sig
	})

	it('relay routine operations', async function() {
		const authorization = new RoutineAuthorization({
			identityContract: id.address,
			relayer: accounts[3],
			outpace: accounts[3], // @TODO deploy an outpace
			feeTokenAddr: token.address,
			feeTokenAmount: 0, // @TODO temp
		})
		const hash = authorization.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))
		const op = [
			2,
			RoutineAuthorization.encodeWithdraw(token.address, userAcc, 150),
		]
		// @TODO: warn about gasLimit in docs, since estimateGas apparently does not calculate properly
		// https://docs.ethers.io/ethers.js/html/api-contract.html#overrides
		const receipt = await (await id.executeRoutines(
			authorization.toSolidityTuple(),
			sig,
			[op],
			{ gasLimit: 500000 }
		)).wait()
		assert.equal(receipt.events.length, 1, 'has an event emitted')
		assert.equal(await token.balanceOf(userAcc), 150, 'user has the right balance')
		//console.log(receipt.gasUsed.toString(10))
		// @TODO fee gets paid only once
		// @TODO can't call after it's no longer valid
		// @TODO can't trick it into calling something disallowed; esp during withdraw FROM identity
	})

	// @TODO: open a channel through the identity, withdraw it through routine authorizations
	it('open a channel, withdraw via routines', async function() {

	})
})
