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
const { getProxyDeployTx, getStorageSlotsFromArtifact } = require('../js/IdentityProxyDeploy')

const ethSign = promisify(web3.eth.sign.bind(web3))

const web3Provider = new providers.Web3Provider(web3.currentProvider)

const DAY_SECONDS = 24 * 60 * 60

// WARNING
// READ THIS!
// gasLimit must be hardcoded cause ganache cannot estimate it properly
// that's cause of the call() that we do here; see https://github.com/AdExNetwork/adex-protocol-eth/issues/55
const gasLimit = 300000

contract('Identity', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	let identityFactory
	let id
	let token
	let coreAddr
	let registryAddr

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
		const idWeb3 = await Identity.new([userAcc], [3])
		id = new Contract(idWeb3.address, Identity._json.abi, signer)
		await token.setBalanceTo(id.address, 10000)
	})

	it('deploy an Identity, counterfactually, and pay the fee', async function() {
		const feeAmnt = 250

		// Generating a proxy deploy transaction
		const deployTx = getProxyDeployTx(
			id.address,
			token.address,
			relayerAddr,
			feeAmnt,
			[[userAcc, 3]],
			// Using this option is fine if the token.address is a token that reverts on failures
			{ unsafeERC20: true, ...getStorageSlotsFromArtifact(Identity) }
			// { safeERC20Artifact: artifacts.require('SafeERC20'), ...getStorageSlotsFromArtifact(Identity) },
		)

		const salt = `0x${Buffer.from(randomBytes(32)).toString('hex')}`
		const expectedAddr = getAddress(
			`0x${generateAddress2(identityFactory.address, salt, deployTx.data).toString('hex')}`
		)

		const deploy = identityFactory.deploy.bind(identityFactory, deployTx.data, salt, { gasLimit })
		// Without any tokens to pay for the fee, we should revert
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
		// id = newIdentity
		// check if deploy fee is paid out
		assert.equal(await token.balanceOf(relayerAddr), feeAmnt, 'fee is paid out')
	})

	it('IdentityFactory - deployAndFund', async function() {
		const fundAmnt = 10000
		// Generating a proxy deploy transaction
		const deployTx = getProxyDeployTx(id.address, token.address, relayerAddr, 0, [[userAcc, 3]], {
			unsafeERC20: true,
			...getStorageSlotsFromArtifact(Identity)
		})

		const salt = `0x${Buffer.from(randomBytes(32)).toString('hex')}`
		const deployAndFund = identityFactory.deployAndFund.bind(
			identityFactory,
			deployTx.data,
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
			identityFactoryUser.deployAndFund(deployTx.data, salt, token.address, fundAmnt, { gasLimit }),
			'ONLY_RELAYER'
		)

		// No tokens, should revert
		await expectEVMError(deployAndFund())

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
		// @TODO: multiple transactions (a few consecutive)
		// @TODO consider testing that using multiple feeTokenAddr's will fail
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: initialNonce,
			feeTokenAddr: token.address,
			feeTokenAmount: 25,
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
			initialBal.toNumber() + relayerTx.feeTokenAmount.toNumber(),
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
		const relayerNextTx = new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeTokenAmount: 5,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 1])
		})
		const newHash = relayerNextTx.hashHex()
		const newSig = splitSig(await ethSign(newHash, userAcc))
		await expectEVMError(
			id.execute([relayerNextTx.toSolidityTuple()], [newSig]),
			'PRIVILEGE_NOT_DOWNGRADED'
		)

		// Try to run a TX from an acc with insufficient privilege
		const relayerTxEvil = new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeTokenAmount: 25,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([evilAcc, 4])
		})
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
			feeTokenAmount: 5,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4])
		}))
		const totalFee = txns.map(x => x.feeTokenAmount).reduce((a, b) => a + b, 0)

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
		const initialNonce = (await id.nonce()).toNumber()
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: initialNonce,
			feeTokenAddr: token.address,
			feeTokenAmount: 0,
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4])
		})

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
		assert.equal((await id.nonce()).toNumber(), initialNonce + 1, 'nonce has increased with 1')
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
			registry: registryAddr,
			validUntil: blockTime + DAY_SECONDS,
			feeTokenAddr: token.address,
			feeTokenAmount: fee
		})
		const hash = auth.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))
		const op = RoutineOps.withdraw(token.address, userAcc, toWithdraw)
		const initialUserBal = await token.balanceOf(userAcc)
		const initialRelayerBal = await token.balanceOf(relayerAddr)
		const execRoutines = id.executeRoutines.bind(id, auth.toSolidityTuple(), sig, [op], {
			gasLimit
		})
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

		// Does not work with an invalid sig
		const invalidSig = splitSig(await ethSign(hash, evilAcc))
		await expectEVMError(
			id.executeRoutines(auth.toSolidityTuple(), invalidSig, [op]),
			'INSUFFICIENT_PRIVILEGE'
		)

		// Does not allow withdrawals to an unauthorized addr
		const evilOp = RoutineOps.withdraw(token.address, evilAcc, toWithdraw)
		await expectEVMError(
			id.executeRoutines(auth.toSolidityTuple(), sig, [evilOp]),
			'INSUFFICIENT_PRIVILEGE_WITHDRAW'
		)

		// We can't tamper with authentication params (outpace in this case)
		const evilTuple = auth.toSolidityTuple()
		evilTuple[2] = token.address // set any other address
		await expectEVMError(id.executeRoutines(evilTuple, sig, [op]), 'INSUFFICIENT_PRIVILEGE')

		// We can no longer call after the authorization has expired
		await moveTime(web3, DAY_SECONDS + 10)
		await expectEVMError(
			id.executeRoutines(auth.toSolidityTuple(), sig, [op]),
			'AUTHORIZATION_EXPIRED'
		)
	})

	it('open a channel, withdraw via routines', async function() {
		const tokenAmnt = 500
		// Open a channel via the identity
		// WARNING: for some reason the latest block timestamp here is not updated after the last test...
		// so we need to workaround with + DAY_SECONDS
		const blockTime = (await web3.eth.getBlock('latest')).timestamp + DAY_SECONDS
		const channel = sampleChannel(
			accounts,
			token.address,
			id.address,
			tokenAmnt,
			blockTime + DAY_SECONDS,
			0
		)
		const coreInterface = new Interface(AdExCore._json.abi)
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber(),
			feeTokenAddr: token.address,
			feeTokenAmount: 0,
			to: coreAddr,
			data: coreInterface.functions.channelOpen.encode([channel.toSolidityTuple()])
		})
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
		// Routine auth to withdraw
		const auth = new RoutineAuthorization({
			identityContract: id.address,
			relayer: relayerAddr,
			outpace: coreAddr,
			registry: registryAddr,
			validUntil: blockTime + DAY_SECONDS,
			feeTokenAddr: token.address,
			feeTokenAmount: 0
		})
		const balBefore = (await token.balanceOf(userAcc)).toNumber()
		const authSig = splitSig(await ethSign(auth.hashHex(), userAcc))
		const routineReceipt = await (await id.executeRoutines(
			auth.toSolidityTuple(),
			authSig,
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
			id.executeRoutines(auth.toSolidityTuple(), authSig, [
				RoutineOps.channelWithdraw(wrongWithdrawArgs)
			]),
			'NOT_SIGNED_BY_VALIDATORS'
		)
	})

	it('channelOpen and channelWithdrawExpired, via routines', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp + DAY_SECONDS
		const tokenAmnt = 1066
		await token.setBalanceTo(id.address, tokenAmnt)

		const auth = new RoutineAuthorization({
			identityContract: id.address,
			relayer: relayerAddr,
			outpace: coreAddr,
			registry: registryAddr,
			validUntil: blockTime + DAY_SECONDS * 4,
			feeTokenAddr: token.address,
			feeTokenAmount: 0
		})
		const authSig = splitSig(await ethSign(auth.hashHex(), userAcc))
		const executeRoutines = id.executeRoutines.bind(id, auth.toSolidityTuple(), authSig)

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
			executeRoutines([RoutineOps.channelOpen([channelEvil.toSolidityTuple()])]),
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
			{
				gasLimit
			}
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
})
