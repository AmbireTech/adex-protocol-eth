const promisify = require('util').promisify
const { providers, Contract } = require('ethers')
const { Interface, randomBytes, getAddress, AbiCoder, keccak256, arrayify, hexlify } = require('ethers').utils
const { generateAddress2 } = require('ethereumjs-util')

const Outpace = artifacts.require('OUTPACE')
const Identity = artifacts.require('Identity')
const IdentityFactory = artifacts.require('IdentityFactory')
const MockToken = artifacts.require('./mocks/Token')
const QuickAccManager = artifacts.require('QuickAccManager')

const { sampleChannel, expectEVMError } = require('./')
const { Withdraw } = require('../js')

const { Transaction, Channel, MerkleTree } = require('../js')
const { getProxyDeployBytecode, getStorageSlotsFromArtifact } = require('../js/IdentityProxyDeploy2')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

// WARNING
// READ THIS!
// gasLimit must be hardcoded cause ganache cannot estimate it properly
// that's cause of the call() that we do here; see https://github.com/AdExNetwork/adex-protocol-eth/issues/55
const gasLimit = 1000000

const TRUE_BYTES = '0x0000000000000000000000000000000000000000000000000000000000000001'
const FALSE_BYTES = '0x0000000000000000000000000000000000000000000000000000000000000000'

contract('Identity', function(accounts) {
	const idInterface = new Interface(Identity._json.abi)
	const coreInterface = new Interface(Outpace._json.abi)

	// The Identity contract factory
	let identityFactory
	// A dummy token
	let token
	// Instance of QuickAccManager
	let quickAccManager
	// An instance of the OUTPACE contract
	let coreAddr
	// an Identity contract that will be used as a base for all proxies
	let baseIdentityAddr
	// The Identity contract instance that will be used
	let id
	// the chainId
	let chainId

	const leader = accounts[1]
	const follower = accounts[2]
	const relayerAddr = accounts[3]
	const userAcc = accounts[4]
	const evilAcc = accounts[5]
	const anotherAccount = accounts[7]

	before(async function() {
		//chainId = (await web3Provider.getNetwork()).chainId
		// we seem to be using 1 in testing conditions for whatever reason
		chainId = 1

		const signer = web3Provider.getSigner(relayerAddr)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
		const coreWeb3 = await Outpace.deployed()
		coreAddr = coreWeb3.address

		// This IdentityFactory is used to test counterfactual deployment
		const idFactoryWeb3 = await IdentityFactory.new({ from: relayerAddr })
		identityFactory = new Contract(idFactoryWeb3.address, IdentityFactory._json.abi, signer)

		// deploy an Identity
		const idWeb3 = await Identity.new([])
		baseIdentityAddr = idWeb3.address

		// a hardcoded test 
		assert.equal(getProxyDeployBytecode('0x02a63ec1bced5545296a5193e652e25ec0bae410', [['0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA', true]]), '0x60017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80602e3d3981f3363d3d373d3d3d363d7302a63ec1bced5545296a5193e652e25ec0bae4105af43d82803e903d91602b57fd5bf3')

		const bytecode = getProxyDeployBytecode(
			baseIdentityAddr,
			[[userAcc, true]],
			{
				...getStorageSlotsFromArtifact(Identity)
			}
		)
		const receipt = await (await identityFactory.deploy(bytecode, 0, { gasLimit })).wait()
		const deployedEv = receipt.events.find(x => x.event === 'LogDeployed')
		id = new Contract(deployedEv.args.addr, Identity._json.abi, signer)

		// the QuickAccManager facilitates access from 2/2 multisig 'quick' acounts
		const quickAccWeb3 = await QuickAccManager.new()
		quickAccManager = new Contract(quickAccWeb3.address, QuickAccManager._json.abi, signer)

		await token.setBalanceTo(id.address, 10000)
	})

	it('protected methods', async function() {
		await expectEVMError(id.setAddrPrivilege(userAcc, TRUE_BYTES, { gasLimit }), 'ONLY_IDENTITY_CAN_CALL')
	})

	it('deploy an Identity, counterfactually', async function() {
		// Generating a proxy deploy transaction
		const [bytecode, salt, expectedAddr] = createAccount([[userAcc, true]], {
			...getStorageSlotsFromArtifact(Identity)
		})
		const deploy = identityFactory.deploy.bind(identityFactory, bytecode, salt, { gasLimit })

		// deploy the contract
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
		assert.equal(await newIdentity.privileges(userAcc), TRUE_BYTES, 'privilege level is OK')
		// it's usually around 69k (155k in v4)
		assert.ok(deployReceipt.gasUsed.toNumber() < 100000, 'gas used for deploying is under 100k')
	})

	// Evaluate if isValidSignature is working correctly
	it('isValidSignature', async function() {
		const msgHash = keccak256('0x21851b')
		const sigUser = await signMsg(userAcc, arrayify(msgHash))
		assert.equal(await id.isValidSignature(msgHash, sigUser), '0x1626ba7e')
		const sigEvil = await signMsg(evilAcc, arrayify(msgHash))
		assert.equal(await id.isValidSignature(msgHash, sigEvil), '0xffffffff')
	})

	it('relay a tx', async function() {
		const initialNonce = (await id.nonce()).toNumber()

		// to, value, data
		const relayerTx = [
			id.address,
			0,
			idInterface.functions.setAddrPrivilege.encode([anotherAccount, TRUE_BYTES])
		]
		const hash = hashTxns(id.address, 1, initialNonce, [relayerTx])

		// Non-authorized address does not work
		const invalidSig = await signMsg(evilAcc, hash) 
		await expectEVMError(
			id.execute([relayerTx], invalidSig),
			'INSUFFICIENT_PRIVILEGE'
		)

		// Do the execute() correctly, verify if it worked
		const relayerTxSig = await signMsg(userAcc, hash)
		const receipt = await (await id.execute([relayerTx], relayerTxSig, {
			gasLimit
		})).wait()
		assert.equal(await id.privileges(anotherAccount), TRUE_BYTES, 'privilege level changed')
		assert.ok(
			receipt.events.find(x => x.event === 'LogPrivilegeChanged'),
			'LogPrivilegeChanged event found'
		)
		assert.equal((await id.nonce()).toNumber(), initialNonce + 1, 'nonce has increased with 1')
		// console.log('relay cost', receipt.gasUsed.toString(10))

		// A nonce can only be used once
		await expectEVMError(id.execute([relayerTx], relayerTxSig), 'INSUFFICIENT_PRIVILEGE')

		// Try to downgrade the privilege: should not be allowed
		const relayerDowngradeTx = [
			id.address,
			0,
			idInterface.functions.setAddrPrivilege.encode([userAcc, FALSE_BYTES])
		]
		const sig = await signMsg(userAcc, hashTxns(id.address, chainId, 1, [relayerDowngradeTx]))
		await expectEVMError(
			id.execute([relayerDowngradeTx], sig),
			'PRIVILEGE_NOT_DOWNGRADED'
		)
	})

	it('quickAccount', async function() {
		const quickAccount = [600, userAcc, anotherAccount]
		const abiCoder = new AbiCoder()
		const accHash = keccak256(abiCoder.encode(['tuple(uint, address, address)'], [quickAccount]))
		const [bytecode, salt, expectedAddr] = createAccount([[quickAccManager.address, accHash]], {
			...getStorageSlotsFromArtifact(Identity)
		})
		const deploy = identityFactory.deploy.bind(identityFactory, bytecode, salt, { gasLimit })

		// just any random hash - the value here doesn't matter
		const msgHash = keccak256('0x21851b')
		const [sig1, sig2] = await Promise.all([
			signMsg(userAcc, arrayify(msgHash)),
			signMsg(anotherAccount, arrayify(msgHash))
		])

		// The part that is evaluated by QuickAccManager
		const sigInner = abiCoder.encode([ 'address', 'uint', 'bytes', 'bytes' ], [expectedAddr, 600, sig1, sig2])
		const sig = sigInner + abiCoder.encode(['address'], [quickAccManager.address]).slice(2) + '03'

		// we need to deploy before being able to validate sigs
		const deployReceipt = await (await deploy()).wait()
		const deployedEv = deployReceipt.events.find(x => x.event === 'LogDeployed')
		const identity = new Contract(deployedEv.args.addr, Identity._json.abi, web3Provider.getSigner(userAcc))
		// 0x1626ba7e is the signature that the function has to return in case of successful verification
		assert.equal(await identity.isValidSignature(msgHash, sig), '0x1626ba7e')
	})

	/*

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
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, true])
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
	*/

	it('execute by sender', async function() {
		const relayerTx = [
			id.address,
			0,
			idInterface.functions.setAddrPrivilege.encode([userAcc, TRUE_BYTES])
		]

		await expectEVMError(
			id.executeBySender([relayerTx]),
			'INSUFFICIENT_PRIVILEGE'
		)

		const idWithUser = new Contract(id.address, Identity._json.abi, web3Provider.getSigner(userAcc))
		const receipt = await (await idWithUser.executeBySender([relayerTx], {
			gasLimit
		})).wait()
		assert.equal(receipt.events.length, 1, 'right number of events emitted')
	})

	/*
	it('actions: channel deposit, withdraw', async function() {
		const tokenAmnt = 500

		const fee = 20

		// Deposit on a channel via the identity
		const channel = sampleChannel(leader, follower, leader, token.address, 0)
		const txns = [
			// we use the deposit on Outpace here
			await zeroFeeTx(
				coreAddr,
				coreInterface.functions.deposit.encode([channel.toSolidityTuple(), id.address, tokenAmnt])
			)
		]
		const sigs = await Promise.all(
			txns.map(async tx => splitSig(await ethSign(tx.hashHex(), userAcc)))
		)
		await (await id.execute(txns.map(x => x.toSolidityTuple()), sigs, { gasLimit })).wait()

		// getting this far, we should have a channel open; now let's withdraw from it
		// Prepare all the data needed for withdrawal
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(channel, id.address, tokenAmnt)
		const withdrawal = new Withdraw({
			channel,
			balanceTreeAmount: tokenAmnt,
			stateRoot,
			sigLeader: vsig1,
			sigFollower: vsig2,
			proof
		})

		const withdrawTxn = [
			new Transaction({
				identityContract: id.address,
				nonce: (await id.nonce()).toNumber(),
				feeTokenAddr: token.address,
				feeAmount: fee,
				to: coreAddr,
				data: coreInterface.functions.withdraw.encode([withdrawal.toSolidityTuple()])
			})
		]
		const withdrawTxnSigs = await Promise.all(
			withdrawTxn.map(async tx => splitSig(await ethSign(tx.hashHex(), userAcc)))
		)

		const [initialIdentityBal, initialRelayerBal] = await Promise.all([
			token.balanceOf(id.address),
			token.balanceOf(relayerAddr)
		])

		const withdrawTxnsTuple = withdrawTxn.map(x => x.toSolidityTuple())
		const executeWithdrawTxn = id.execute.bind(id, withdrawTxnsTuple, withdrawTxnSigs, {
			gasLimit
		})
		const executeWithdrawnReceipt = await (await executeWithdrawTxn()).wait()
		const balAfter = (await token.balanceOf(id.address)).toNumber()
		assert.equal(
			balAfter - initialIdentityBal.toNumber(),
			tokenAmnt - fee,
			'token amount withdrawn is right'
		)
		// withdraw (channel to Identity), LogChannelWithdraw, Transfer (fee)
		assert.equal(executeWithdrawnReceipt.events.length, 3, 'right number of events')

		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + fee,
			'relayer has received the fee'
		)
	})

	it('IdentityFactory: deployAndExecute', async function() {
		const tokenAmnt = 1000
		const feeAmount = 120
		await token.setBalanceTo(userAcc, tokenAmnt)

		const [initialFactoryBal, initialRelayerBal] = await Promise.all([
			await token.balanceOf(identityFactory.address),
			await token.balanceOf(relayerAddr)
		])

		const channel = sampleChannel(leader, follower, userAcc, token.address, 122)

		const core = new Contract(coreAddr, Outpace._json.abi, web3Provider.getSigner(userAcc))
		await (await core.deposit(channel.toSolidityTuple(), userAcc, tokenAmnt)).wait()

		const [bytecode, salt, expectedAddr] = createAccount([[userAcc, 2]], {
			...getStorageSlotsFromArtifact(Identity)
		})
		assert.equal(
			(await token.balanceOf(expectedAddr)).toNumber(),
			0,
			'the balance of the new Identity is 0'
		)

		// Prepare all the data needed for withdrawal
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(channel, expectedAddr, tokenAmnt)

		const withdrawal = new Withdraw({
			channel,
			balanceTreeAmount: tokenAmnt,
			stateRoot,
			sigLeader: vsig1,
			sigFollower: vsig2,
			proof
		})

		// Make the tx that will call the rotuines
		const tx1 = new Transaction({
			identityContract: expectedAddr,
			nonce: 0,
			feeTokenAddr: token.address,
			feeAmount,
			to: coreAddr,
			data: coreInterface.functions.withdraw.encode([withdrawal.toSolidityTuple()])
		})

		const sig = splitSig(await ethSign(tx1.hashHex(), userAcc))

		const receipt = await (await identityFactory.deployAndExecute(
			bytecode,
			salt,
			[tx1.toSolidityTuple()],
			[sig],
			{
				gasLimit
			}
		)).wait()
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
		await (await identityFactory.withdraw(token.address, relayerAddr, feeAmount, {
			gasLimit
		})).wait()
		assert.equal(
			await token.balanceOf(relayerAddr),
			initialRelayerBal.toNumber() + feeAmount,
			'relayer balance is correct'
		)
	})

	// This is a "super-counterfactual" test: we will create an account, this account will earn from a channel,
	// and THEN we will, at once, create the contract, sweep the channel and allow the account to withdraw their funds
	it('IdentityFactory: deployAndExecute: create a new account after it has already earned from channels, withdraw via routines', async function() {
		const tokenAmnt = 500
		await token.setBalanceTo(userAcc, tokenAmnt * 3)

		const txFeeAmount = 100

		const [initialRelayerBal, initialFactoryBal] = await Promise.all([
			token.balanceOf(relayerAddr),
			token.balanceOf(identityFactory.address)
		])

		const maxToWithdraw = tokenAmnt - txFeeAmount
		const accountToWithdrawTo = accounts[9]

		// Create a new channel
		const channel = sampleChannel(leader, follower, userAcc, token.address, 122)

		const core = new Contract(coreAddr, Outpace._json.abi, web3Provider.getSigner(userAcc))
		await (await core.deposit(channel.toSolidityTuple(), userAcc, tokenAmnt)).wait()

		// Create a new account
		const [bytecode, salt, expectedAddr] = createAccount([[userAcc, 1]], {
			...getStorageSlotsFromArtifact(Identity)
		})

		// Prepare all the data needed for withdrawal
		const [stateRoot, vsig1, vsig2, proof] = await getWithdrawData(channel, expectedAddr, tokenAmnt)
		const withdrawal = new Withdraw({
			channel,
			balanceTreeAmount: tokenAmnt,
			stateRoot,
			sigLeader: vsig1,
			sigFollower: vsig2,
			proof
		})

		// Make the tx that will call the rotuines
		const withdrawTx = new Transaction({
			identityContract: expectedAddr,
			nonce: 0,
			feeTokenAddr: token.address,
			feeAmount: 0,
			to: coreAddr,
			data: coreInterface.functions.withdraw.encode([withdrawal.toSolidityTuple()])
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
		const txns = [withdrawTx, txToWithdraw]
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
		// LogDeployed, LogChannelWithdraw, channel sweep Transfer, 1 fee Transfers, the withdraw Transfer
		assert.equal(receipt.events.length, 5, 'events length is right')
		// console.log('gas used:', receipt.gasUsed.toNumber())

		assert.equal(
			(await token.balanceOf(accountToWithdrawTo)).toNumber(),
			maxToWithdraw,
			'we managed to withdraw our balance out of the identity'
		)

		// since the factory is the sender...
		assert.equal(
			(await token.balanceOf(identityFactory.address)).toNumber(),
			initialFactoryBal.toNumber() + txFeeAmount,
			'factory has received fee'
		)

		assert.equal(
			(await token.balanceOf(relayerAddr)).toNumber(),
			initialRelayerBal.toNumber(),
			'relayer balance is unchanged'
		)

		// we should be able to withdraw to relayer addr
		const amountToWithdraw = (await token.balanceOf(identityFactory.address)).toNumber()
		await expectEVMError(
			identityFactory
				.connect(web3Provider.getSigner(userAcc))
				.withdraw(token.address, relayerAddr, amountToWithdraw),
			'ONLY_CREATOR'
		)
		const factoryWithdrawReceipt = await (await identityFactory.withdraw(
			token.address,
			relayerAddr,
			amountToWithdraw
		)).wait()
		assert.equal(factoryWithdrawReceipt.events.length, 1, 'events length is right')
		assert.equal(
			(await token.balanceOf(relayerAddr)).toNumber(),
			amountToWithdraw + initialRelayerBal.toNumber(),
			'withdraw earnings from IdentityFactory'
		)
	})
	*/
	function hashTxns(identityAddr, chainId, nonce, txns) {
		const abiCoder = new AbiCoder()
		const encoded = abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [identityAddr, chainId, nonce, txns])
		return arrayify(keccak256(encoded))
	}

	function mapSignatureV(sig) {
		sig = arrayify(sig)
		if (sig[64] < 27) sig[64] += 27
		return hexlify(sig)
	}

	async function signMsg(from, hash) {
		assert.equal(hash.length, 32, 'hash must be 32byte array buffer')
		// 02 is the enum number of EthSign signature type
		return mapSignatureV(await web3Provider.getSigner(from).signMessage(hash)) + '02'
	}

	function createAccount(privileges, opts) {
		const bytecode = getProxyDeployBytecode(baseIdentityAddr, privileges, opts)
		const salt = `0x${Buffer.from(randomBytes(32)).toString('hex')}`
		const expectedAddr = getAddress(
			`0x${generateAddress2(identityFactory.address, salt, bytecode).toString('hex')}`
		)
		return [bytecode, salt, expectedAddr]
	}

	/*
	async function getWithdrawData(channel, addr, tokenAmnt) {
		const elem1 = Channel.getBalanceLeaf(addr, tokenAmnt)
		const tree = new MerkleTree([elem1])
		const proof = tree.proof(elem1)
		const stateRoot = tree.getRoot()
		const hashToSignHex = channel.hashToSignHex(coreAddr, stateRoot)
		const [sig1, sig2] = await Promise.all([leader, follower].map(v => ethSign(hashToSignHex, v)))
		return [stateRoot, splitSig(sig1), splitSig(sig2), proof]
	}

	async function zeroFeeTx(to, data, nonceOffset = 0) {
		return new Transaction({
			identityContract: id.address,
			nonce: (await id.nonce()).toNumber() + nonceOffset,
			feeTokenAddr: token.address,
			feeAmount: 0,
			to,
			data
		})
	}
	*/
})
