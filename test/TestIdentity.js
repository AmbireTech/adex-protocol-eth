const AdExCore = artifacts.require('AdExCore')
const Identity = artifacts.require('Identity')
const IdentityFactory = artifacts.require('IdentityFactory')
const MockToken = artifacts.require('./mocks/Token')

const { Transaction, RoutineAuthorization, splitSig, Channel, MerkleTree } = require('../js')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { providers, Contract, ContractFactory } = require('ethers')
const { Interface, randomBytes, getAddress } = require('ethers').utils
const web3Provider = new providers.Web3Provider(web3.currentProvider)

const DAY_SECONDS = 24 * 60 * 60

// @TODO remove this when we implement the ValidatorRegistry
const NULL_ADDR = '0x0000000000000000000000000000000000000000'

contract('Identity', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	const coreInterface = new Interface(AdExCore._json.abi)
	let identityFactory
	let id
	let token
	let coreAddr

	const relayerAddr = accounts[3]
	const userAcc = accounts[4]
	const evilAcc = accounts[5]

	before(async function() {
		const signer = web3Provider.getSigner(relayerAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const coreWeb3 = await AdExCore.deployed()
		coreAddr = coreWeb3.address
		// deploy this with a 0 fee, cause w/o the counterfactual deployment we can't send tokens to the addr first
		const idWeb3 = await Identity.new([userAcc], [3], NULL_ADDR)
		id = new Contract(idWeb3.address, Identity._json.abi, signer)
		await token.setBalanceTo(id.address, 10000)

		// This IdentityFactory is used to test counterfactual deployment
		const idFactoryWeb3 = await IdentityFactory.new()
		identityFactory = new Contract(idFactoryWeb3.address, IdentityFactory._json.abi, signer)
	})

	it('deploy an Identity, counterfactually, and pay the fee', async function() {
		const feeAmnt = 250

		// Create a proxy
		// @TODO fee
		// @TODO generate this via solc
		// @TODO all the TODOs in the IdentityProxy.sol prototype
		const byteCode = `0x608060405234801561001057600080fd5b50600360008073${userAcc.toLowerCase().slice(2)}73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060006101000a81548160ff021916908360ff16021790555073${NULL_ADDR.slice(2)}600160006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff160217905550610195806100e16000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806351da2eaa1461007b578063c066a5b1146100c5575b73${id.address.toLowerCase().slice(2)}600054163660008037600080366000846127105a03f43d604051816000823e8260008114610077578282f35b8282fd5b610083610123565b604051808273ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200191505060405180910390f35b610107600480360360208110156100db57600080fd5b81019080803573ffffffffffffffffffffffffffffffffffffffff169060200190929190505050610149565b604051808260ff1660ff16815260200191505060405180910390f35b600160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b60006020528060005260406000206000915054906101000a900460ff168156fea165627a7a723058205623ea0fb0e176a3acbb29ef6ac17f255717003c178c0949709126cbce18e6aa0029`
		const deployTx = { data: byteCode }
		// Generating a deploy transaction
		/*
		const factory = new ContractFactory(Identity._json.abi, Identity._json.bytecode)
		const deployTx = factory.getDeployTransaction(
			// deploy fee will be feeAmnt to relayerAddr
			token.address, relayerAddr, feeAmnt,
			// userAcc will have privilege 3 (everything)
			[userAcc], [3],
			// @TODO: change that when we implement the registry
			NULL_ADDR,
		)*/
		const salt = '0x'+Buffer.from(randomBytes(32)).toString('hex')
		const { generateAddress2 } = require('ethereumjs-util')
		const expectedAddr = getAddress('0x'+generateAddress2(identityFactory.address, salt, deployTx.data).toString('hex'))

		// set the balance so that we can pay out the fee when deploying
		await token.setBalanceTo(expectedAddr, 10000)

		// deploy the contract, which should also pay out the fee
		const deployReceipt = await (await identityFactory.deploy(deployTx.data, salt, { gasLimit: 400*1000 })).wait()

		// The counterfactually generated expectedAddr matches
		const deployEv = deployReceipt.events.find(x => x.event === 'Deployed')
		assert.equal(expectedAddr, deployEv.args.addr, 'counterfactual contract address matches')
		
		// privilege level is OK
		const newIdentity = new Contract(expectedAddr, Identity._json.abi, web3Provider.getSigner(relayerAddr))
		assert.equal(await newIdentity.privileges(userAcc), 3, 'privilege level is OK')

		//console.log('deploy cost', deployReceipt.gasUsed.toString(10))
		//id = newIdentity
		// check if deploy fee is paid out
		//assert.equal(await token.balanceOf(relayerAddr), feeAmnt, 'fee is paid out')
	})

	it('relay a tx', async function() {
		assert.equal(await id.privileges(userAcc), 3, 'privilege is 3 to start with')

		const initialBal = await token.balanceOf(relayerAddr)
		const initialNonce = (await id.nonce()).toNumber()
		// @TODO: multiple transactions (a few consecutive)
		// @TODO consider testing that using multiple feeTokenAddr's will fail
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: initialNonce,
			feeTokenAddr: token.address,
			feeTokenAmount: 25,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4]),
		})
		const hash = relayerTx.hashHex()

		// Non-authorized address does not work
		const invalidSig = splitSig(await ethSign(hash, evilAcc))
		await expectEVMError(
			id.execute([relayerTx.toSolidityTuple()], [invalidSig]),
			'INSUFFICIENT_PRIVILEGE'
		)

		// Do the execute() correctly, verify if it worked
		// @TODO: set gasLimit manually everywhere
		const sig = splitSig(await ethSign(hash, userAcc))

		const receipt = await (await id.execute([relayerTx.toSolidityTuple()], [sig], { gasLimit: 200*1000 })).wait()

		assert.equal(await id.privileges(userAcc), 4, 'privilege level changed')
		assert.equal(await token.balanceOf(relayerAddr), initialBal.toNumber() + relayerTx.feeTokenAmount.toNumber(), 'relayer has received the tx fee')
		assert.ok(receipt.events.find(x => x.event == 'LogPrivilegeChanged'), 'LogPrivilegeChanged event found')
		assert.equal((await id.nonce()).toNumber(), initialNonce+1, 'nonce has increased with 1')
		//console.log('relay cost', receipt.gasUsed.toString(10))

		// setAddrPrivilege can only be invoked by the contract
		await expectEVMError(id.setAddrPrivilege(userAcc, 0), 'ONLY_IDENTITY_CAN_CALL')

		// A nonce can only be used once
		await expectEVMError(id.execute([relayerTx.toSolidityTuple()], [sig]), 'WRONG_NONCE')

		// Try to downgrade the privilege: should not be allowed
		const relayerNextTx = new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeTokenAmount: 5,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 1]),
		})
		const newHash = relayerNextTx.hashHex()
		const newSig = splitSig(await ethSign(newHash, userAcc))
		await expectEVMError(id.execute([relayerNextTx.toSolidityTuple()], [newSig]), 'PRIVILEGE_NOT_DOWNGRADED')

		// Try to run a TX from an acc with insufficient privilege
		const relayerTxEvil = new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeTokenAmount: 25,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([evilAcc, 4]),
		})
		const hashEvil = relayerTxEvil.hashHex()
		const sigEvil = splitSig(await ethSign(hashEvil, evilAcc))
		await expectEVMError(id.execute([relayerTxEvil.toSolidityTuple()], [sigEvil]), 'INSUFFICIENT_PRIVILEGE_TRANSACTION')
	})

	it('relay routine operations', async function() {
		// note: the balance of id.address is way higher than toWithdraw, allowing us to do the withdraw multiple times in the test
		const toWithdraw = 150
		const fee = 20
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const auth = new RoutineAuthorization({
			identityContract: id.address,
			relayer: relayerAddr,
			outpace: coreAddr,
			validUntil: blockTime + DAY_SECONDS,
			feeTokenAddr: token.address,
			feeTokenAmount: fee,
		})
		const hash = auth.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))
		const op = [
			2,
			RoutineAuthorization.encodeWithdraw(token.address, userAcc, toWithdraw),
		]
		// @TODO: warn about gasLimit in docs, since estimateGas apparently does not calculate properly
		// https://docs.ethers.io/ethers.js/html/api-contract.html#overrides
		const initialUserBal = await token.balanceOf(userAcc)
		const initialRelayerBal = await token.balanceOf(relayerAddr)
		const execRoutines = id.executeRoutines.bind(
			id,
			auth.toSolidityTuple(),
			sig,
			[op],
			{ gasLimit: 500000 }
		)
		const receipt = await (await execRoutines()).wait()
		//console.log(receipt.gasUsed.toString(10))

		// Transfer (withdraw), Transfer (fee)
		assert.equal(receipt.events.length, 2, 'has right number of events')
		assert.equal(await token.balanceOf(userAcc), initialUserBal.toNumber() + toWithdraw, 'user has the right balance after withdrawal')
		assert.equal(await token.balanceOf(relayerAddr), initialRelayerBal.toNumber() + fee, 'relayer has received the fee')

		// Do it again to make sure the fee is not paid out twice
		await (await execRoutines()).wait()
		assert.equal(await token.balanceOf(userAcc), initialUserBal.toNumber() + toWithdraw*2, 'user has the right balance after second withdrawal')
		assert.equal(await token.balanceOf(relayerAddr), initialRelayerBal.toNumber() + fee, 'relayer has received the fee only once')

		// Does not work with an invalid sig
		const invalidSig = splitSig(await ethSign(hash, evilAcc))
		await expectEVMError(id.executeRoutines(auth.toSolidityTuple(), invalidSig, [op]), 'INSUFFICIENT_PRIVILEGE')

		// Does not allow withdrawals to an unauthorized addr
		const evilOp = [2, RoutineAuthorization.encodeWithdraw(token.address, evilAcc, toWithdraw)]
		await expectEVMError(
			id.executeRoutines(auth.toSolidityTuple(), sig, [evilOp]),
			'INSUFFICIENT_PRIVILEGE_WITHDRAW'
		)

		// We can't tamper with authentication params (outpace in this case)
		const evilTuple = auth.toSolidityTuple()
		evilTuple[2] = token.address // set any other address
		await expectEVMError(
			id.executeRoutines(evilTuple, sig, [op]),
			'INSUFFICIENT_PRIVILEGE'
		)

		// We can no longer call after the authorization has expired
		await moveTime(web3, DAY_SECONDS+10)
		await expectEVMError(
			id.executeRoutines(auth.toSolidityTuple(), sig, [op]),
			'AUTHORIZATION_EXPIRED'
		)
	})

	it('open a channel, withdraw via routines', async function() {
		const tokenAmnt = 500
		// WARNING: for some reason the latest block timestamp here is not updated after the last test...
		// so we need to workaround with + DAY_SECONDS
		const blockTime = (await web3.eth.getBlock('latest')).timestamp + DAY_SECONDS
		const channel = sampleChannel(id.address, tokenAmnt, blockTime+DAY_SECONDS, 0)
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
		const receipt = await (await id.execute([relayerTx.toSolidityTuple()], [sig], { gasLimit: 800000 })).wait()
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
		// @TODO more elegant way to do this
		const withdrawData = '0x'+coreInterface.functions.channelWithdraw.encode([channel.toSolidityTuple(), stateRoot, [vsig1, vsig2], proof, tokenAmnt]).slice(10)

		// Routine auth to withdraw
		const auth = new RoutineAuthorization({
			identityContract: id.address,
			relayer: relayerAddr,
			outpace: coreAddr,
			validUntil: blockTime + DAY_SECONDS,
			feeTokenAddr: token.address,
			feeTokenAmount: 0,
		})
		const balBefore = (await token.balanceOf(userAcc)).toNumber()
		const routineReceipt = await (await id.executeRoutines(
			auth.toSolidityTuple(),
			splitSig(await ethSign(auth.hashHex(), userAcc)),
			[
				[ 0, withdrawData ],
				// @TODO: op1, withdraw expired
				[ 2, RoutineAuthorization.encodeWithdraw(token.address, userAcc, tokenAmnt) ],
			],
			{ gasLimit: 900000 }
		)).wait()
		const balAfter = (await token.balanceOf(userAcc)).toNumber()
		assert.equal(balAfter-balBefore, tokenAmnt, 'token amount withdrawn is right')
		// Transfer, ChannelWithdraw, Transfer
		assert.equal(routineReceipt.events.length, 3, 'right number of events')
		// @TODO: more assertions?
	})

	async function expectEVMError(promise, errString) {
		try {
			await promise;
			assert.isOk(false, 'should have failed with '+errString)
		} catch(e) {
			assert.isOk(
				e.message.match(
					new RegExp('VM Exception while processing transaction: revert '+errString)
				),
				'wrong error: '+e.message + ', Expected ' + errString
			)
		}
	}

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
	function moveTime(web3, time) {
		return new Promise(function(resolve, reject) {
			web3.currentProvider.send({
				jsonrpc: '2.0',
				method: 'evm_increaseTime',
				params: [time],
				id: 0,
			}, (err, res) => err ? reject(err) : resolve(res))
		})
	}

})
