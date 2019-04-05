const promisify = require('util').promisify
const { providers, Contract } = require('ethers')
const { Interface, randomBytes, getAddress } = require('ethers').utils
const { generateAddress2 } = require('ethereumjs-util')

const AdExCore = artifacts.require('AdExCore')
const Identity = artifacts.require('Identity')
const IdentityFactory = artifacts.require('IdentityFactory')
const Registry = artifacts.require('Registry')
const MockToken = artifacts.require('./mocks/Token')

const { moveTime, sampleChannel, expectEVMError } = require('./')
const {
	Transaction,
	RoutineAuthorization,
	RoutineOps,
	Channel,
	splitSig,
	MerkleTree
} = require('../js')
const { getProxyDeployBytecode, getStorageSlotsFromArtifact } = require('../js/IdentityProxyDeploy')

const ethSign = promisify(web3.eth.sign.bind(web3))

const web3Provider = new providers.Web3Provider(web3.currentProvider)

const DAY_SECONDS = 24 * 60 * 60

// WARNING
// READ THIS!
// gasLimit must be hardcoded cause ganache cannot estimate it properly
// that's cause of the call() that we do here; see https://github.com/AdExNetwork/adex-protocol-eth/issues/55
const gasLimit = 400000

contract('Identity', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	// The Identity contract factory
	let identityFactory
	// A dummy token
	let token
	// An instance of the AdExCore (OUTPACE) contract
	let coreAddr
	// the registry that's used in the RoutineAuthorizations
	let registryAddr
	// an Identity contract that will be used as a base for all proxies
	let baseIdentityAddr
	// default RoutineAuthorization that's valid forever
	let defaultAuth
	// The Identity contract instance that will be used
	let id

	const relayerAddr = accounts[3]
	const userAcc = accounts[4]
	const evilAcc = accounts[5]
	const allowedValidator1 = accounts[6]
	const allowedValidator2 = accounts[7]

	before(async function() {
		const signer = web3Provider.getSigner(relayerAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const coreWeb3 = await AdExCore.deployed()
		coreAddr = coreWeb3.address

		// deploy a registry; this is required by the Identity
		const registryWeb3 = await Registry.new()
		await registryWeb3.setWhitelisted(allowedValidator1, true)
		await registryWeb3.setWhitelisted(allowedValidator2, true)
		registryAddr = registryWeb3.address

		// This IdentityFactory is used to test counterfactual deployment
		const idFactoryWeb3 = await IdentityFactory.new(relayerAddr)
		identityFactory = new Contract(idFactoryWeb3.address, IdentityFactory._json.abi, signer)

		// deploy an Identity
		const idWeb3 = await Identity.new([], [])
		baseIdentityAddr = idWeb3.address

		// We use this default RoutineAuthorization
		// for various tests
		defaultAuth = new RoutineAuthorization({
			relayer: relayerAddr,
			outpace: coreAddr,
			registry: registryAddr,
			validUntil: 1900000000,
			feeTokenAddr: token.address,
			weeklyFeeAmount: 0
		})
		const bytecode = getProxyDeployBytecode(baseIdentityAddr, [[userAcc, 3]], {
			routineAuthorizations: [defaultAuth.hash()],
			...getStorageSlotsFromArtifact(Identity)
		})
		const receipt = await (await identityFactory.deploy(bytecode, 0, { gasLimit })).wait()
		const deployedEv = receipt.events.find(x => x.event === 'LogDeployed')
		id = new Contract(deployedEv.args.addr, Identity._json.abi, signer)

		await token.setBalanceTo(id.address, 10000)
	})

	it('deploy an Identity, counterfactually, and pay the fee', async function() {
		const feeAmnt = 250

		// Generating a proxy deploy transaction
		const bytecode = getProxyDeployBytecode(baseIdentityAddr, [[userAcc, 3]], {
			fee: {
				tokenAddr: token.address,
				recepient: relayerAddr,
				amount: feeAmnt,
				// Using this option is fine if the token.address is a token that reverts on failures
				unsafeERC20: true
				// safeERC20Artifact: artifacts.require('SafeERC20')
			},
			...getStorageSlotsFromArtifact(Identity)
		})

		const salt = `0x${Buffer.from(randomBytes(32)).toString('hex')}`
		const expectedAddr = getAddress(
			`0x${generateAddress2(identityFactory.address, salt, bytecode).toString('hex')}`
		)

		const deploy = identityFactory.deploy.bind(identityFactory, bytecode, salt, { gasLimit })
		// Without any tokens to pay for the fee, we should revert
		// if this is failing, then the contract is probably not trying to pay the fee
		await expectEVMError(deploy(), 'FAILED_DEPLOYING')

		// set the balance so that we can pay out the fee when deploying
		await token.setBalanceTo(expectedAddr, 10000)

		// deploy the contract, which should also pay out the fee
		const deployReceipt = await (await deploy()).wait()

		// The counterfactually generated expectedAddr matches
		const deployEv = deployReceipt.events.find(x => x.event === 'LogDeployed')
		assert.ok(deployEv, 'has deployedEv')
		assert.equal(expectedAddr, deployEv.args.addr, 'counterfactual contract address matches')

		// privilege level is OK
		const newIdentity = new Contract(
			expectedAddr,
			Identity._json.abi,
			web3Provider.getSigner(relayerAddr)
		)
		assert.equal(await newIdentity.privileges(userAcc), 3, 'privilege level is OK')

		// console.log('deploy cost', deployReceipt.gasUsed.toString(10))
		// check if deploy fee is paid out
		assert.equal(await token.balanceOf(relayerAddr), feeAmnt, 'fee is paid out')
	})

	it('IdentityFactory - deployAndFund', async function() {
		const fundAmnt = 10000
		// Generating a proxy deploy transaction
		const bytecode = getProxyDeployBytecode(id.address, [[userAcc, 3]], {
			...getStorageSlotsFromArtifact(Identity)
		})

		const salt = `0x${Buffer.from(randomBytes(32)).toString('hex')}`
		const deployAndFund = identityFactory.deployAndFund.bind(
			identityFactory,
			bytecode,
			salt,
			token.address,
			fundAmnt,
			{ gasLimit }
		)

		// Only relayer can call
		const userSigner = web3Provider.getSigner(userAcc)
		const identityFactoryUser = new Contract(
			identityFactory.address,
			IdentityFactory._json.abi,
			userSigner
		)
		await expectEVMError(
			identityFactoryUser.deployAndFund(bytecode, salt, token.address, fundAmnt, { gasLimit }),
			'ONLY_RELAYER'
		)

		// No tokens, should revert
		await expectEVMError(deployAndFund(), 'INSUFFICIENT_FUNDS')

		// Set tokens
		await token.setBalanceTo(identityFactory.address, fundAmnt)

		// Call successfully
		const receipt = await (await deployAndFund()).wait()
		const deployedEv = receipt.events.find(x => x.event === 'LogDeployed')
		assert.ok(deployedEv, 'has deployedEv')
		assert.equal(
			await token.balanceOf(deployedEv.args.addr),
			fundAmnt,
			'deployed contract has received the funding amount'
		)
	})

	it('relay a tx', async function() {
		assert.equal(await id.privileges(userAcc), 3, 'privilege is 3 to start with')

		const initialBal = await token.balanceOf(relayerAddr)
		const initialNonce = (await id.nonce()).toNumber()
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: initialNonce,
			feeTokenAddr: token.address,
			feeAmount: 25,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4])
		})
		const hash = relayerTx.hashHex()

		// Non-authorized address does not work
		const invalidSig = splitSig(await ethSign(hash, evilAcc))
		await expectEVMError(
			id.execute([relayerTx.toSolidityTuple()], [invalidSig]),
			'INSUFFICIENT_PRIVILEGE_TRANSACTION'
		)

		// Do the execute() correctly, verify if it worked
		const sig = splitSig(await ethSign(hash, userAcc))

		const receipt = await (await id.execute([relayerTx.toSolidityTuple()], [sig], {
			gasLimit
		})).wait()

		assert.equal(await id.privileges(userAcc), 4, 'privilege level changed')
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialBal.toNumber() + relayerTx.feeAmount.toNumber(),
			'relayer has received the tx fee'
		)
		assert.ok(
			receipt.events.find(x => x.event === 'LogPrivilegeChanged'),
			'LogPrivilegeChanged event found'
		)
		assert.equal((await id.nonce()).toNumber(), initialNonce + 1, 'nonce has increased with 1')
		// console.log('relay cost', receipt.gasUsed.toString(10))

		// setAddrPrivilege can only be invoked by the contract
		await expectEVMError(id.setAddrPrivilege(userAcc, 0), 'ONLY_IDENTITY_CAN_CALL')

		// A nonce can only be used once
		await expectEVMError(id.execute([relayerTx.toSolidityTuple()], [sig]), 'WRONG_NONCE')

		// Try to downgrade the privilege: should not be allowed
		const relayerNextTx = await zeroFeeTx(
			id.address,
			idInterface.functions.setAddrPrivilege.encode([userAcc, 1])
		)

		const newHash = relayerNextTx.hashHex()
		const newSig = splitSig(await ethSign(newHash, userAcc))
		await expectEVMError(
			id.execute([relayerNextTx.toSolidityTuple()], [newSig]),
			'PRIVILEGE_NOT_DOWNGRADED'
		)

		// Try to run a TX from an acc with insufficient privilege
		const relayerTxEvil = await zeroFeeTx(
			id.address,
			idInterface.functions.setAddrPrivilege.encode([evilAcc, 4])
		)
		const hashEvil = relayerTxEvil.hashHex()
		const sigEvil = splitSig(await ethSign(hashEvil, evilAcc))
		await expectEVMError(
			id.execute([relayerTxEvil.toSolidityTuple()], [sigEvil]),
			'INSUFFICIENT_PRIVILEGE_TRANSACTION'
		)
	})

	// Relay two transactions
	// this could be quite useful in real applications, e.g. approve and call into a contract in one TX
	it('relay multiple transactions', async function() {
		const getTuples = txns => txns.map(tx => new Transaction(tx).toSolidityTuple())
		const getSigs = function(txns) {
			return Promise.all(
				txns.map(args => {
					const tx = new Transaction(args)
					const hash = tx.hashHex()
					return ethSign(hash, userAcc).then(sig => splitSig(sig))
				})
			)
		}

		const initialBal = await token.balanceOf(relayerAddr)
		const initialNonce = (await id.nonce()).toNumber()
		const txns = [100, 200].map((n, i) => ({
			identityContract: id.address,
			nonce: initialNonce + i,
			feeTokenAddr: token.address,
			feeAmount: 5,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4])
		}))
		const totalFee = txns.map(x => x.feeAmount).reduce((a, b) => a + b, 0)

		// Cannot use an invalid identityContract
		const invalidTxns1 = [txns[0], { ...txns[1], identityContract: token.address }]
		await expectEVMError(
			id.execute(getTuples(invalidTxns1), await getSigs(invalidTxns1)),
			'TRANSACTION_NOT_FOR_CONTRACT'
		)

		// Cannot use a different fee token
		const invalidTxns2 = [txns[0], { ...txns[1], feeTokenAddr: accounts[8] }]
		await expectEVMError(
			id.execute(getTuples(invalidTxns2), await getSigs(invalidTxns2)),
			'EXECUTE_NEEDS_SINGLE_TOKEN'
		)

		const receipt = await (await id.execute(getTuples(txns), await getSigs(txns), {
			gasLimit
		})).wait()
		// 2 times LogPrivilegeChanged, 1 transfer (fee)
		assert.equal(receipt.events.length, 3, 'has the right events length')
		assert.equal(
			receipt.events.filter(x => x.event === 'LogPrivilegeChanged').length,
			2,
			'LogPrivilegeChanged happened twice'
		)
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialBal.toNumber() + totalFee,
			'fee was paid out for all transactions'
		)
	})

	it('execute by sender', async function() {
		const relayerTx = await zeroFeeTx(
			id.address,
			idInterface.functions.setAddrPrivilege.encode([userAcc, 4])
		)

		await expectEVMError(
			id.executeBySender([relayerTx.toSolidityTuple()]),
			'INSUFFICIENT_PRIVILEGE_SENDER'
		)

		const idWithSender = new Contract(
			id.address,
			Identity._json.abi,
			web3Provider.getSigner(userAcc)
		)
		const receipt = await (await idWithSender.executeBySender([relayerTx.toSolidityTuple()], {
			gasLimit
		})).wait()
		assert.equal(receipt.events.length, 1, 'right number of events emitted')

    const initialNonce = parseInt(relayerTx.nonce, 10)
		assert.equal((await id.nonce()).toNumber(), initialNonce + 1, 'nonce has increased with 1')

		const invalidNonceTx = new Transaction({
			...relayerTx,
			nonce: relayerTx.nonce-1
		})
		await expectEVMError(idWithSender.executeBySender([invalidNonceTx.toSolidityTuple()]), 'WRONG_NONCE')

		const invalidPrivTx = new Transaction({
			...relayerTx,
			nonce: (await id.nonce()).toNumber(),
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 1]),
		})
		await expectEVMError(idWithSender.executeBySender([invalidPrivTx.toSolidityTuple()]), 'PRIVILEGE_NOT_DOWNGRADED')
	})

	it('relay routine operations', async function() {
		// NOTE: the balance of id.address is way higher than toWithdraw, allowing us to do the withdraw multiple times in the test
		const toWithdraw = 150
		const fee = 20
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const auth = new RoutineAuthorization({
			relayer: relayerAddr,
			outpace: coreAddr,
			registry: registryAddr,
			validUntil: blockTime + 14 * DAY_SECONDS,
			feeTokenAddr: token.address,
			weeklyFeeAmount: fee
		})

		// Activate this routine authorization
		const tx = await zeroFeeTx(
			id.address,
			idInterface.functions.setRoutineAuth.encode([auth.hashHex(), true])
		)
		const sig = splitSig(await ethSign(tx.hashHex(), userAcc))
		await (await id.execute([tx.toSolidityTuple()], [sig], { gasLimit })).wait()

		// setRoutineAuth can only be invoked by the contract
		await expectEVMError(id.setRoutineAuth(auth.hashHex(), userAcc), 'ONLY_IDENTITY_CAN_CALL')

		// Create the operation and relay it
		// the operation is simply to withdraw from the id contract to userAcc
		const op = RoutineOps.withdraw(token.address, userAcc, toWithdraw)
		const initialUserBal = await token.balanceOf(userAcc)
		const initialRelayerBal = await token.balanceOf(relayerAddr)
		const execRoutines = id.executeRoutines.bind(id, auth.toSolidityTuple(), [op], { gasLimit })
		const receipt = await (await execRoutines()).wait()
		// console.log(receipt.gasUsed.toString(10))

		// Transfer (withdraw), Transfer (fee)
		assert.equal(receipt.events.length, 2, 'has right number of events')
		assert.equal(
			await token.balanceOf(userAcc),
			initialUserBal.toNumber() + toWithdraw,
			'user has the right balance after withdrawal'
		)
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + fee,
			'relayer has received the fee'
		)

		// Do it again to make sure the fee is not paid out twice
		await (await execRoutines()).wait()
		assert.equal(
			await token.balanceOf(userAcc),
			initialUserBal.toNumber() + toWithdraw * 2,
			'user has the right balance after second withdrawal'
		)
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + fee,
			'relayer has received the fee only once'
		)

		// Does not work with an invalid routine auth
		const invalidAuth1 = new RoutineAuthorization({ ...auth, registry: userAcc })
		await expectEVMError(id.executeRoutines(invalidAuth1.toSolidityTuple(), [op]), 'NOT_AUTHORIZED')
		const invalidAuth2 = new RoutineAuthorization({ ...auth, relayer: userAcc })
		await expectEVMError(
			id.executeRoutines(invalidAuth2.toSolidityTuple(), [op]),
			'ONLY_RELAYER_CAN_CALL'
		)

		// Does not allow withdrawals to an unauthorized addr
		const evilOp = RoutineOps.withdraw(token.address, evilAcc, toWithdraw)
		await expectEVMError(
			id.executeRoutines(auth.toSolidityTuple(), [evilOp]),
			'INSUFFICIENT_PRIVILEGE_WITHDRAW'
		)

		// We can't tamper with authentication params (outpace in this case)
		const evilTuple = auth.toSolidityTuple()
		evilTuple[2] = token.address // set any other address
		await expectEVMError(id.executeRoutines(evilTuple, [op]), 'NOT_AUTHORIZED')

		// Fee will be paid again, since it's weekly
		await moveTime(web3, DAY_SECONDS * 7 + 10)
		await (await execRoutines()).wait()
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + fee * 2,
			'relayer has received the fee twice'
		)

		// We can no longer call after the authorization has expired
		await moveTime(web3, DAY_SECONDS * 7 + 10)
		await expectEVMError(id.executeRoutines(auth.toSolidityTuple(), [op]), 'AUTHORIZATION_EXPIRED')
	})

	it('open a channel, withdraw it via routines', async function() {
		const tokenAmnt = 500
		// Open a channel via the identity
		// WARNING: for some reason the latest block timestamp here is not updated after the last test...
		// so we need to workaround with + 8 * DAY_SECONDS
		const blockTime = (await web3.eth.getBlock('latest')).timestamp + 8 * DAY_SECONDS
		const channel = sampleChannel(
			accounts,
			token.address,
			id.address,
			tokenAmnt,
			blockTime + DAY_SECONDS,
			0
		)
		const coreInterface = new Interface(AdExCore._json.abi)
		const relayerTx = await zeroFeeTx(
			coreAddr,
			coreInterface.functions.channelOpen.encode([channel.toSolidityTuple()])
		)
		const hash = relayerTx.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))
		await (await id.execute([relayerTx.toSolidityTuple()], [sig], {
			gasLimit
		})).wait()
		// getting this far, we should have a channel open; now let's withdraw from it
		// console.log(receipt.gasUsed.toString(10))

		// Prepare all the data needed for withdrawal
		const elem1 = Channel.getBalanceLeaf(id.address, tokenAmnt)
		const tree = new MerkleTree([elem1])
		const proof = tree.proof(elem1)
		const stateRoot = tree.getRoot()
		const hashToSignHex = channel.hashToSignHex(coreAddr, stateRoot)
		const vsig1 = splitSig(await ethSign(hashToSignHex, accounts[0]))
		const vsig2 = splitSig(await ethSign(hashToSignHex, accounts[1]))
		const balBefore = (await token.balanceOf(userAcc)).toNumber()
		const routineReceipt = await (await id.executeRoutines(
			defaultAuth.toSolidityTuple(),
			[
				RoutineOps.channelWithdraw([
					channel.toSolidityTuple(),
					stateRoot,
					[vsig1, vsig2],
					proof,
					tokenAmnt
				]),
				RoutineOps.withdraw(token.address, userAcc, tokenAmnt)
			],
			{ gasLimit }
		)).wait()
		const balAfter = (await token.balanceOf(userAcc)).toNumber()
		assert.equal(balAfter - balBefore, tokenAmnt, 'token amount withdrawn is right')
		// Transfer (channel to Identity), ChannelWithdraw, Transfer (Identity to userAcc)
		assert.equal(routineReceipt.events.length, 3, 'right number of events')

		// wrongWithdrawArgs: flipped the signatures
		const wrongWithdrawArgs = [
			channel.toSolidityTuple(),
			stateRoot,
			[vsig2, vsig1],
			proof,
			tokenAmnt
		]
		await expectEVMError(
			id.executeRoutines(defaultAuth.toSolidityTuple(), [
				RoutineOps.channelWithdraw(wrongWithdrawArgs)
			]),
			'NOT_SIGNED_BY_VALIDATORS'
		)
	})

	it('channelOpen and channelWithdrawExpired, via routines', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp + DAY_SECONDS
		const tokenAmnt = 1066
		await token.setBalanceTo(id.address, tokenAmnt)

		const executeRoutines = id.executeRoutines.bind(id, defaultAuth.toSolidityTuple())

		// a channel with non-whitelisted validators
		const channelEvil = sampleChannel(
			[allowedValidator1, accounts[2]],
			token.address,
			id.address,
			tokenAmnt,
			blockTime + DAY_SECONDS,
			0
		)
		await expectEVMError(
			executeRoutines([RoutineOps.channelOpen([channelEvil.toSolidityTuple()])], { gasLimit }),
			'VALIDATOR_NOT_WHITELISTED'
		)

		// we can open a channel with the whitelisted validators
		const channel = sampleChannel(
			[allowedValidator1, allowedValidator2],
			token.address,
			id.address,
			tokenAmnt,
			blockTime + DAY_SECONDS,
			0
		)
		const receipt = await (await executeRoutines(
			[RoutineOps.channelOpen([channel.toSolidityTuple()])],
			{ gasLimit }
		)).wait()
		// events should be: transfer, channelOpen
		assert.ok(receipt.events.length, 2, 'Transfer, ChannelOpen events emitted')

		// withdrawExpired should work
		const withdrawExpiredOp = RoutineOps.channelWithdrawExpired([channel.toSolidityTuple()])
		// ensure we report the underlying OUTPACE error properly
		await expectEVMError(executeRoutines([withdrawExpiredOp]), 'NOT_EXPIRED')

		// move time, withdrawExpired successfully and check results
		await moveTime(web3, DAY_SECONDS * 3)
		const expiredReceipt = await (await executeRoutines([withdrawExpiredOp], { gasLimit })).wait()
		// LogWithdrawExpired and Transfer
		assert.equal(expiredReceipt.events.length, 2, 'right event count')
		assert.equal(await token.balanceOf(id.address), tokenAmnt, 'full deposit refunded')
	})

	async function zeroFeeTx(to, data) {
		return new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeAmount: 0,
			to,
			data
		})
	}
})
