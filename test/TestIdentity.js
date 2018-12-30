const Identity = artifacts.require('Identity')
const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')

const { Transaction, RoutineAuthorization, splitSig, getIdentityDeployData, Channel, MerkleTree } = require('../js')

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
		coreAddr = coreWeb3.address
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
			nonce: (await id.nonce()).toNumber(),
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
			relayer: relayerAddr,
			outpace: coreAddr,
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
		const tokenAmnt = 500
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(id.address, tokenAmnt, blockTime+1000, 0)
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeTokenAmount: 0,
			to: coreAddr,
			data: coreInterface.functions.channelOpen.encode([channel.toSolidityTuple()]),
		})
		const hash = relayerTx.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))
		await (await id.execute([relayerTx.toSolidityTuple()], [sig], { gasLimit: 800000 })).wait()
		// getting this far, we should have a channel open; now let's withdraw from it
		//console.log(receipt.gasUsed.toString(10))

		// Prepare all the data needed for withdrawal
		const elem1 = Channel.getBalanceLeaf(id.address, tokenAmnt)
		const tree = new MerkleTree([ elem1 ])
		const proof = tree.proof(elem1)
		const stateRoot = tree.getRoot()
		const hashToSignHex = channel.hashToSignHex(coreAddr, stateRoot)
		const vsig1 = splitSig(await ethSign(hashToSignHex, accounts[0]))
		const vsig2 = splitSig(await ethSign(hashToSignHex, accounts[1]))
		const withdrawData = coreInterface.functions.channelWithdraw.encode([channel.toSolidityTuple(), stateRoot, [vsig1, vsig2], proof, tokenAmnt])
		console.log(proof, stateRoot)

		// Routine authorization to withdraw
		const authorization = new RoutineAuthorization({
			identityContract: id.address,
			relayer: relayerAddr,
			outpace: coreAddr,
			feeTokenAddr: token.address,
			feeTokenAmount: 0,
		})
		console.log(await token.balanceOf(id.address))
		await (await id.executeRoutines(
			authorization.toSolidityTuple(),
			splitSig(await ethSign(authorization.hashHex(), userAcc)),
			[[ 0, withdrawData ]],
			{ gasLimit: 900000 }
		)).wait()
		console.log(await token.balanceOf(id.address))
	})

	function sampleChannel(creator, amount, validUntil, nonce) {
		const spec = new Buffer(32)
		spec.writeUInt32BE(nonce)
		return new Channel({
			creator,
			tokenAddr: token.address,
			tokenAmount: amount,
			validUntil,
			validators: [accounts[0], accounts[1]],
			spec,
		})
	}


})
