const Identity = artifacts.require('Identity')
const AdExCore = artifacts.require('AdExCore')
const MockToken = artifacts.require('./mocks/Token')

const { Transaction, RoutineAuthorization, splitSig, getIdentityDeployData, Channel, MerkleTree } = require('../js')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { providers, Contract, ContractFactory } = require('ethers')
const { Interface, randomBytes } = require('ethers').utils
const web3Provider = new providers.Web3Provider(web3.currentProvider)

const DAY_SECONDS = 24 * 60 * 60

// @TODO remove this when we implement the ValidatorRegistry
const NULL_ADDR = '0x0000000000000000000000000000000000000000'

contract('Identity', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	const coreInterface = new Interface(AdExCore._json.abi)
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
		const idWeb3 = await Identity.new(token.address, relayerAddr, 0, [userAcc], [3], NULL_ADDR)
		id = new Contract(idWeb3.address, Identity._json.abi, signer)
		await token.setBalanceTo(id.address, 10000)
	})

	it('deploy an Identity, counterfactually, and pay the fee', async function() {
		const feeAmnt = 250

		// Generating a deploy transaction
		const factory = new ContractFactory(Identity._json.abi, Identity._json.bytecode)
		const deployTx = factory.getDeployTransaction(
			// deploy fee will be feeAmnt to relayerAddr
			token.address, relayerAddr, feeAmnt,
			// userAcc will have privilege 3 (everything)
			[userAcc], [3],
			// @TODO: change that when we implement the registry
			NULL_ADDR,
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
			'INSUFFICIENT_PRIVILEGE_TRANSACTION'
		)

		// Do the execute() correctly, verify if it worked
		// @TODO: set gasLimit manually
		const sig = splitSig(await ethSign(hash, userAcc))
		const receipt = await (await id.execute([relayerTx.toSolidityTuple()], [sig])).wait()

		assert.equal(await id.privileges(userAcc), 4, 'privilege level changed')
		assert.equal(await token.balanceOf(relayerAddr), initialBal.toNumber() + relayerTx.feeTokenAmount.toNumber(), 'relayer has received the tx fee')
		assert.ok(receipt.events.find(x => x.event == 'LogPrivilegeChanged'), 'LogPrivilegeChanged event found')
		assert.equal((await id.nonce()).toNumber(), initialNonce+1, 'nonce has increased with 1')
		//console.log(receipt.gasUsed.toString(10))

		// setAddrPrivilege can only be invoked by the contract
		await expectEVMError(id.setAddrPrivilege(userAcc, 0), 'ONLY_IDENTITY_CAN_CALL')

		// A nonce can only be used once
		await expectEVMError(id.execute([relayerTx.toSolidityTuple()], [sig]), 'WRONG_NONCE')


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

		const relayerTxEvil = new Transaction({
			identityContract: accounts[1],
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeTokenAmount: 25,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4]),
		})
		const hashEvil = relayerTxEvil.hashHex()
		const sigEvil = splitSig(await ethSign(hashEvil, userAcc))
		await expectEVMError(id.execute([relayerTxEvil.toSolidityTuple()], [sigEvil]), 'TRANSACTION_NOT_FOR_CONTRACT')

		const relayerTxs = [
			new Transaction({
				identityContract: id.address,
				nonce: (await id.nonce()).toNumber(),
				feeTokenAddr: token.address,
				feeTokenAmount: 5,
				to: id.address,
				data: idInterface.functions.setAddrPrivilege.encode([userAcc, 3]),
			}),
			new Transaction({
				identityContract: id.address,
				nonce: (await id.nonce()).toNumber() + 1,
				feeTokenAddr: accounts[1],
				feeTokenAmount: 5,
				to: id.address,
				data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4]),
			})
		]
		const hashes = [ relayerTxs[0].hashHex(), relayerTxs[1].hashHex() ]
		const sigs = [ splitSig(await ethSign(hashes[0], userAcc)), splitSig(await ethSign(hashes[1], userAcc)) ]
		await expectEVMError(id.execute([relayerTxs[0].toSolidityTuple(), relayerTxs[1].toSolidityTuple()], sigs), 'EXECUTE_NEEDS_SINGLE_TOKEN')
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
			assert.equal(
				e.message,
				'VM Exception while processing transaction: revert '+errString,
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
