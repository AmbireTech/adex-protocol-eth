const Identity = artifacts.require('Identity')
const MockToken = artifacts.require('./mocks/Token')

const { Transaction, RoutineAuthorization, splitSig } = require('../js')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { providers, Contract } = require('ethers')
const Interface = require('ethers').utils.Interface
const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('Identity', function(accounts) {
	let id
	let idInterface = new Interface(Identity._json.abi)
	let token

	const relayerAddr = accounts[3]
	const userAcc = accounts[4]

	before(async function() {
		const signer = web3Provider.getSigner(accounts[0])
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
	})

	it('deploy an Identity', async function() {
		const feeAmnt = 250

		// Generating a deploy transaction
		// @TODO: move this out into js/Identity
		// @TODO Is it OK to assume 0 for v, should we look into: https://bitcoin.stackexchange.com/questions/38351/ecdsa-v-r-s-what-is-v and https://github.com/ethereum/EIPs/issues/155 and https://blog.sigmaprime.io/solidity-security.html#one-time-addresses
		const { ContractFactory, utils } = require('ethers')
		const keccak256 = require('js-sha3').keccak256
		const factory = new ContractFactory(Identity._json.abi, Identity._json.bytecode)
		const deployTx = factory.getDeployTransaction(userAcc, 3, token.address, relayerAddr, feeAmnt)
		/*const seed = utils.randomBytes(256)
		const r = new Buffer(keccak256.arrayBuffer(seed))
		const sig = {
			r: '0x0'+r.toString('hex').slice(0, 63),
			s: '0x0'+new Buffer(keccak256.arrayBuffer(r)).toString('hex').slice(0, 63),
			recoveryParam: 0,
			v: 27,
		}*/
		let randomS = utils.keccak256(utils.randomBytes(3))
		randomS = '0' + randomS.substring(3, randomS.length)
		const sig = '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'+randomS+'1b'
		const deployTxRaw = utils.serializeTransaction({...deployTx, gasPrice: 1 * 10**9, gasLimit: 4*1000*1000 }, sig)
		const deployTxParsed = utils.parseTransaction(deployTxRaw)
		// end of generating a deploy transaction

		// @TODO: (r, s) ranges
		const deployAddr = deployTxParsed.from
		// fund the deploy addr with enough eth to deploy
		await web3.eth.sendTransaction({ from: relayerAddr, to: deployAddr, value: deployTxParsed.gasLimit * deployTxParsed.gasPrice })

		//console.log(deployTxRaw)

		// Calculate the id.address in advance
		// really, we need to concat 0xd694{address}00
		// same as require('rlp').encode([relayerAddr, 0x00]) or ethers.utils.RPL.encode([relayerAddr, ... (dunno what)])
		// @TODO: move this out into js/Identity
		const rlpEncodedInput = Buffer.concat([
			// rpl encoding values
			new Uint8Array([0xd6, 0x94]),
			// sender
			Buffer.from(deployAddr.slice(2), 'hex'),
			// nonce (0x80 is equivalent to nonce 0)
			new Uint8Array([0x80]),
		])
		const digest = new Buffer(keccak256.arrayBuffer(rlpEncodedInput))
		// could use ethers.utils.getAddress
		const idAddr = '0x'+digest.slice(-20).toString('hex')
		// set the balance so that we can pay out the fee when deploying
		await token.setBalanceTo(idAddr, 10000)
		// deploy the contract, whcih should also pay out the fee
		const deployReceipt = await web3.eth.sendSignedTransaction(deployTxRaw)
		// check if deploy fee is paid out
		assert.equal(await token.balanceOf(relayerAddr), feeAmnt, 'fee is paid out')

		// set id to an ethersjs contract
		const signer = web3Provider.getSigner(relayerAddr)
		id = new Contract(idAddr, Identity._json.abi, signer)	
	})

	it('relay a tx', async function() {
		assert.equal(await id.privileges(userAcc), 3, 'privilege is 3 to start with')

		const initialBal = await token.balanceOf(relayerAddr)
		// @TODO: multiple transactions
		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: 0,
			feeTokenAddr: token.address,
			feeTokenAmount: 15,
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
		// @TODO test a few consequtive transactions
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

	// UTILS
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
