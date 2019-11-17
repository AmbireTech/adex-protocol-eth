const promisify = require('util').promisify
const { providers, Contract } = require('ethers')
const { Interface, randomBytes, getAddress } = require('ethers').utils
const { generateAddress2 } = require('ethereumjs-util')

const AdExCore = artifacts.require('AdExCore')
const Identity = artifacts.require('Identity')
const IdentityFactory = artifacts.require('IdentityFactory')
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
const { solcModule } = require('../js/solc')

const ethSign = promisify(web3.eth.sign.bind(web3))

const web3Provider = new providers.Web3Provider(web3.currentProvider)

const DAY_SECONDS = 24 * 60 * 60

// WARNING
// READ THIS!
// gasLimit must be hardcoded cause ganache cannot estimate it properly
// that's cause of the call() that we do here; see https://github.com/AdExNetwork/adex-protocol-eth/issues/55
const gasLimit = 1000000

contract('Identity', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	const coreInterface = new Interface(AdExCore._json.abi)

	// The Identity contract factory
	let identityFactory
	// A dummy token
	let token
	// An instance of the AdExCore (OUTPACE) contract
	let coreAddr
	// an Identity contract that will be used as a base for all proxies
	let baseIdentityAddr
	// default RoutineAuthorization that's valid forever
	let defaultAuth
	// The Identity contract instance that will be used
	let id

	const validators = accounts.slice(0, 2)
	const relayerAddr = accounts[3]
	const userAcc = accounts[4]
	const evilAcc = accounts[5]
	const channelCreatorAddr = accounts[7]
	const channelSigner = web3Provider.getSigner(channelCreatorAddr)

	before(async function() {
		const signer = web3Provider.getSigner(relayerAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const coreWeb3 = await AdExCore.deployed()
		coreAddr = coreWeb3.address

		// This IdentityFactory is used to test counterfactual deployment
		const idFactoryWeb3 = await IdentityFactory.new({ from: relayerAddr })
		identityFactory = new Contract(idFactoryWeb3.address, IdentityFactory._json.abi, signer)

		// deploy an Identity
		const idWeb3 = await Identity.new([], [])
		baseIdentityAddr = idWeb3.address

		// We use this default RoutineAuthorization
		// for various tests
		defaultAuth = new RoutineAuthorization({
			relayer: relayerAddr,
			outpace: coreAddr,
			validUntil: 1900000000,
			feeTokenAddr: token.address,
			weeklyFeeAmount: 0
		})
		const bytecode = getProxyDeployBytecode(
			baseIdentityAddr,
			[[userAcc, 3]],
			{
				routineAuthorizations: [defaultAuth.hash()],
				...getStorageSlotsFromArtifact(Identity)
			},
			solcModule
		)
		const receipt = await (await identityFactory.deploy(bytecode, 0, { gasLimit })).wait()
		const deployedEv = receipt.events.find(x => x.event === 'LogDeployed')
		id = new Contract(deployedEv.args.addr, Identity._json.abi, signer)

		await token.setBalanceTo(id.address, 10000)
	})

	it('protected methods', async function() {
		await expectEVMError(id.setAddrPrivilege(userAcc, 0, { gasLimit }), 'ONLY_IDENTITY_CAN_CALL')
		await expectEVMError(
			id.setRoutineAuth(defaultAuth.hash(), true, { gasLimit }),
			'ONLY_IDENTITY_CAN_CALL'
		)
		const channel = sampleChannel(accounts.slice(0, 2), token.address, id.address, 0, 0, 0)
		await expectEVMError(
			id.channelOpen(coreAddr, channel.toSolidityTuple(), { gasLimit }),
			'ONLY_IDENTITY_CAN_CALL'
		)
	})

	it('deploy an Identity, counterfactually, and pay the fee', async function() {
		const feeAmnt = 250

		// Generating a proxy deploy transaction
		const [bytecode, salt, expectedAddr] = createAccount([[userAcc, 3]], {
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
		// it's usually around 155k
		assert.ok(deployReceipt.gasUsed.toNumber() < 200000, 'gas used for deploying is under 200k')
		// check if deploy fee is paid out
		assert.equal(await token.balanceOf(relayerAddr), feeAmnt, 'fee is paid out')
	})

	it('relay a tx: setAddrPrivilege', async function() {
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

		const receipt = await (
			await id.execute([relayerTx.toSolidityTuple()], [sig], {
				gasLimit
			})
		).wait()

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

		// A nonce can only be used once
		await expectEVMError(id.execute([relayerTx.toSolidityTuple()], [sig]), 'WRONG_NONCE')

		// Try to downgrade the privilege: should not be allowed
		const relayerDowngradeTx = await zeroFeeTx(
			id.address,
			idInterface.functions.setAddrPrivilege.encode([userAcc, 1])
		)
		const newHash = relayerDowngradeTx.hashHex()
		const newSig = splitSig(await ethSign(newHash, userAcc))
		await expectEVMError(
			id.execute([relayerDowngradeTx.toSolidityTuple()], [newSig]),
			'PRIVILEGE_NOT_DOWNGRADED'
		)

		// Try to run a TX from an acc with insufficient privilege (unauthorized account)
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

		const receipt = await (
			await id.execute(getTuples(txns), await getSigs(txns), {
				gasLimit
			})
		).wait()
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

		const idWithUser = new Contract(id.address, Identity._json.abi, web3Provider.getSigner(userAcc))
		const receipt = await (
			await idWithUser.executeBySender([relayerTx.toSolidityTuple()], {
				gasLimit
			})
		).wait()
		assert.equal(receipt.events.length, 1, 'right number of events emitted')

		const initialNonce = parseInt(relayerTx.nonce, 10)
		assert.equal((await id.nonce()).toNumber(), initialNonce + 1, 'nonce has increased with 1')

		const invalidNonceTx = new Transaction({
			...relayerTx,
			nonce: relayerTx.nonce - 1
		})
		await expectEVMError(
			idWithUser.executeBySender([invalidNonceTx.toSolidityTuple()]),
			'WRONG_NONCE'
		)
	})

	it('relay routine operations', async function() {
		// NOTE: the balance of id.address is way higher than toWithdraw, allowing us to do the withdraw multiple times in the test
		const toWithdraw = 150
		const fee = 20
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const auth = new RoutineAuthorization({
			relayer: relayerAddr,
			outpace: coreAddr,
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

		// Create the operation and relay it
		// the operation is simply to withdraw from the id contract to userAcc
		const op = RoutineOps.withdraw(token.address, userAcc, toWithdraw)
		const initialUserBal = await token.balanceOf(userAcc)
		const initialRelayerBal = await token.balanceOf(relayerAddr)
		const executeRoutines = id.executeRoutines.bind(id, auth.toSolidityTuple(), [op], { gasLimit })
		const receipt = await (await executeRoutines()).wait()
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
		await (await executeRoutines()).wait()
		assert.equal(
			await token.balanceOf(userAcc),
			initialUserBal.toNumber() + toWithdraw * 2,
			'user has the right balance after second withdrawal'
		)
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + fee,
			'relayer has received the fee only once for now'
		)

		// Does not work with an invalid routine auth
		const invalidAuth1 = new RoutineAuthorization({ ...auth, outpace: userAcc })
		await expectEVMError(id.executeRoutines(invalidAuth1.toSolidityTuple(), [op]), 'NOT_AUTHORIZED')
		const invalidAuth2 = new RoutineAuthorization({ ...auth, relayer: userAcc })
		await expectEVMError(
			id.executeRoutines(invalidAuth2.toSolidityTuple(), [op]),
			'NOT_AUTHORIZED_ADDR'
		)

		// Does not allow withdrawals to an unauthorized addr
		const evilOp = RoutineOps.withdraw(token.address, evilAcc, toWithdraw)
		await expectEVMError(
			id.executeRoutines(auth.toSolidityTuple(), [evilOp]),
			'INSUFFICIENT_PRIVILEGE_WITHDRAW'
		)

		// Fee will be paid again, since it's weekly
		await moveTime(web3, DAY_SECONDS * 7 + 10)
		await (await executeRoutines()).wait()
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + fee * 2,
			'relayer has received the fee twice'
		)

		// We can no longer call after the authorization has expired
		await moveTime(web3, DAY_SECONDS * 7 + 10)
		await expectEVMError(id.executeRoutines(auth.toSolidityTuple(), [op]), 'AUTHORIZATION_EXPIRED')
	})

	it('routines: open a channel, channelWithdraw', async function() {
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
		// we use the channelOpen on the Identity here, just to see if it works too
		const relayerTx = await zeroFeeTx(
			// coreAddr,
			// coreInterface.functions.channelOpen.encode([channel.toSolidityTuple()])
			id.address,
			idInterface.functions.channelOpen.encode([coreAddr, channel.toSolidityTuple()])
		)
		const hash = relayerTx.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))
		const handle = await id.execute([relayerTx.toSolidityTuple()], [sig], { gasLimit })
		await handle.wait()
		// getting this far, we should have a channel open; now let's withdraw from it

		// Prepare all the data needed for withdrawal
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(channel, id.address, tokenAmnt)
		const balBefore = (await token.balanceOf(userAcc)).toNumber()
		const routineReceipt = await (
			await id.executeRoutines(
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
			)
		).wait()
		const balAfter = (await token.balanceOf(userAcc)).toNumber()
		assert.equal(balAfter - balBefore, tokenAmnt, 'token amount withdrawn is right')
		// Transfer (channel to Identity), ChannelWithdraw, Transfer (Identity to userAcc)
		assert.equal(routineReceipt.events.length, 3, 'right number of events')
	})

	it('routines: open a channel, and channelWithdrawExpired', async function() {
		const blockTime = (await web3.eth.getBlock('latest')).timestamp + DAY_SECONDS
		const tokenAmnt = 1066
		await token.setBalanceTo(id.address, tokenAmnt)

		const channel = sampleChannel(
			validators,
			token.address,
			id.address,
			tokenAmnt,
			blockTime + DAY_SECONDS,
			0
		)
		const relayerTx = await zeroFeeTx(
			coreAddr,
			coreInterface.functions.channelOpen.encode([channel.toSolidityTuple()])
		)
		const hash = relayerTx.hashHex()
		const sig = splitSig(await ethSign(hash, userAcc))
		await (await id.execute([relayerTx.toSolidityTuple()], [sig], { gasLimit })).wait()

		// Checks if all our funds have been locked in the channel
		assert.equal(
			await token.balanceOf(id.address),
			0,
			'channel has been opened and all our funds are locked up'
		)

		const executeRoutines = id.executeRoutines.bind(id, defaultAuth.toSolidityTuple())

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

	it('IdentityFactory: deployAndExecute', async function() {
		const tokenAmnt = 1000
		const feeAmount = 120
		await token.setBalanceTo(channelCreatorAddr, tokenAmnt)

		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const [initialFactoryBal, initialRelayerBal] = await Promise.all([
			await token.balanceOf(identityFactory.address),
			await token.balanceOf(relayerAddr)
		])

		const channel = sampleChannel(
			validators,
			token.address,
			channelCreatorAddr,
			tokenAmnt,
			blockTime + DAY_SECONDS,
			0
		)
		const core = new Contract(coreAddr, AdExCore._json.abi, channelSigner)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		const [bytecode, salt, expectedAddr] = createAccount([[userAcc, 3]], {
			...getStorageSlotsFromArtifact(Identity)
		})
		assert.equal(
			(await token.balanceOf(expectedAddr)).toNumber(),
			0,
			'the balance of the new Identity is 0'
		)

		// Prepare all the data needed for withdrawal
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(channel, expectedAddr, tokenAmnt)

		const tx1 = new Transaction({
			identityContract: expectedAddr,
			nonce: 0,
			feeTokenAddr: token.address,
			// This fee would pay for the transaction AND for the deploy
			// The relayer can just check if this is sufficient to pay for the deploy and decide whether to relay based on that
			feeAmount,
			to: coreAddr,
			data: coreInterface.functions.channelWithdraw.encode([
				channel.toSolidityTuple(),
				stateRoot,
				[vsig1, vsig2],
				proof,
				tokenAmnt
			])
		})
		const sig = splitSig(await ethSign(tx1.hashHex(), userAcc))

		const receipt = await (
			await identityFactory.deployAndExecute(bytecode, salt, [tx1.toSolidityTuple()], [sig], {
				gasLimit
			})
		).wait()
		// LogChannelWithdraw, Transfer (withdraw), Transfer (tx fee), LogDeployed
		assert.equal(receipt.events.length, 4, 'proper events length')
		assert.equal(
			(await token.balanceOf(expectedAddr)).toNumber(),
			tokenAmnt - feeAmount,
			'Identity balance is correct'
		)
		assert.equal(
			(await token.balanceOf(identityFactory.address)).toNumber(),
			initialFactoryBal.toNumber() + feeAmount,
			'IdentityFactory balance is correct'
		)

		// Only relayer allowed to withdraw fee
		const identityFactoryEvil = new Contract(
			identityFactory.address,
			IdentityFactory._json.abi,
			web3Provider.getSigner(evilAcc)
		)
		await expectEVMError(
			identityFactoryEvil.withdraw(token.address, evilAcc, feeAmount, { gasLimit }),
			'ONLY_CREATOR'
		)

		// Relayer can withdraw the fee
		await (
			await identityFactory.withdraw(token.address, relayerAddr, feeAmount, {
				gasLimit
			})
		).wait()
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + feeAmount,
			'relayer balance is correct'
		)
	})

	// This is a "super-counterfactual" test: we will create an account, this account will earn from a channel,
	// and THEN we will, at once, create the contract, sweep the channel and allow the account to withdraw their funds
	it('IdentityFactory: deployAndExecute: create a new account after it has already earned from channels, withdraw via routines', async function() {
		const tokenAmnt = 100000
		await token.setBalanceTo(channelCreatorAddr, tokenAmnt)

		// The two fees here: the RoutineAuthorization fee and the txFee will pay for the deploy itself
		// the relayer can decide whether to relay the tx if this fee is sufficient
		const weeklyFeeAmount = 250
		const auth = new RoutineAuthorization({
			relayer: relayerAddr,
			outpace: coreAddr,
			validUntil: 1900000000,
			feeTokenAddr: token.address,
			weeklyFeeAmount
		})
		const txFeeAmount = 100

		const [initialRelayerBal, initialFactoryBal] = await Promise.all([
			token.balanceOf(relayerAddr),
			token.balanceOf(identityFactory.address)
		])

		const maxToWithdraw = tokenAmnt - (weeklyFeeAmount + txFeeAmount)
		const accountToWithdrawTo = accounts[9]

		// Create a new channel
		const blockTime = (await web3.eth.getBlock('latest')).timestamp
		const channel = sampleChannel(
			validators,
			token.address,
			channelCreatorAddr,
			tokenAmnt,
			blockTime + DAY_SECONDS,
			0
		)
		const core = new Contract(coreAddr, AdExCore._json.abi, channelSigner)
		await (await core.channelOpen(channel.toSolidityTuple())).wait()

		// Create a new account
		const [bytecode, salt, expectedAddr] = createAccount([[userAcc, 3]], {
			routineAuthorizations: [auth.hash()],
			...getStorageSlotsFromArtifact(Identity)
		})

		// Prepare all the data needed for withdrawal
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(channel, expectedAddr, tokenAmnt)

		// We will sweep the channel (channelWithdraw) via a routine
		const channelSweepOp = RoutineOps.channelWithdraw([
			channel.toSolidityTuple(),
			stateRoot,
			[vsig1, vsig2],
			proof,
			tokenAmnt
		])

		// Make the tx that will call the rotuines
		const txRoutines = new Transaction({
			identityContract: expectedAddr,
			nonce: 0,
			feeTokenAddr: token.address,
			feeAmount: 0,
			to: expectedAddr,
			data: idInterface.functions.executeRoutines.encode([auth.toSolidityTuple(), [channelSweepOp]])
		})

		// Now the regular tx to withdraw our funds out of our Identity
		const tokenInterface = new Interface(MockToken._json.abi)
		const txToWithdraw = new Transaction({
			identityContract: expectedAddr,
			nonce: 1,
			feeTokenAddr: token.address,
			feeAmount: txFeeAmount,
			to: token.address,
			data: tokenInterface.functions.transfer.encode([accountToWithdrawTo, maxToWithdraw])
		})
		const txns = [txRoutines, txToWithdraw]
		const sigs = await Promise.all(
			txns.map(async tx => splitSig(await ethSign(tx.hashHex(), userAcc)))
		)

		const handle = await identityFactory.deployAndExecute(
			bytecode,
			salt,
			txns.map(tx => tx.toSolidityTuple()),
			sigs,
			{ gasLimit }
		)
		const receipt = await handle.wait()
		assert.ok(receipt.events.some(x => x.event === 'LogDeployed'))
		// LogDeployed, LogChannelWithdraw, channel sweep Transfer, 2 fee Transfers, the withdraw Transfer
		assert.equal(receipt.events.length, 6, 'events length is right')
		// console.log('gas used:', receipt.gasUsed.toNumber())

		assert.equal(
			await token.balanceOf(accountToWithdrawTo),
			maxToWithdraw,
			'we managed to withdraw our balance out of the identity'
		)

		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + weeklyFeeAmount,
			'relayer has received fee'
		)
		// since the factory is the sender...
		assert.equal(
			await token.balanceOf(identityFactory.address),
			initialFactoryBal.toNumber() + txFeeAmount,
			'factory has received fee'
		)
	})

	function createAccount(privileges, opts) {
		const bytecode = getProxyDeployBytecode(baseIdentityAddr, privileges, opts, solcModule)
		const salt = `0x${Buffer.from(randomBytes(32)).toString('hex')}`
		const expectedAddr = getAddress(
			`0x${generateAddress2(identityFactory.address, salt, bytecode).toString('hex')}`
		)
		return [bytecode, salt, expectedAddr]
	}
	async function getWithdrawData(channel, addr, tokenAmnt) {
		const elem1 = Channel.getBalanceLeaf(addr, tokenAmnt)
		const tree = new MerkleTree([elem1])
		const proof = tree.proof(elem1)
		const stateRoot = tree.getRoot()
		const hashToSignHex = channel.hashToSignHex(coreAddr, stateRoot)
		const [sig1, sig2] = await Promise.all(validators.map(v => ethSign(hashToSignHex, v)))
		return [stateRoot, splitSig(sig1), splitSig(sig2), proof]
	}
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
