const Identity = artifacts.require('Identity')
const MockToken = artifacts.require('./mocks/Token')

const { Transaction, RoutineAuthorization } = require('../js/Transaction')
const { splitSig } = require('../js')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { providers, Contract } = require('ethers')
const Interface = require('ethers').utils.Interface
const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('Identity', function(accounts) {
	let id
	let idInterface = new Interface(Identity._json.abi)
	let token

	before(async function() {
		// 3 is the relayer, 4 is the acc
		const signer = web3Provider.getSigner(accounts[3])
		const idWeb3 = await Identity.new(accounts[4], 3)
		id = new Contract(idWeb3.address, Identity._json.abi, signer)
		const tokenWeb3 = await MockToken.new()
		token = new Contract(tokenWeb3.address, MockToken._json.abi, signer)
	})

	beforeEach(async function() {
		await token.setBalanceTo(id.address, 10000)
	})

	it('relay a tx', async function() {
		const userAcc = accounts[4]

		assert.equal(await id.privileges(userAcc), 3, 'privilege is 3 to start with')

		const relayerTx = new Transaction({
			identityContract: id.address,
			nonce: 0,
			feeTokenAddr: accounts[0], // @TODO temp
			feeTokenAmount: 0, // @TODO temp
			to: id.address,
			data: idInterface.functions.setAddrPrivilege.encode([userAcc, 4]),
		})
		const hash = relayerTx.hashHex();
		const sig = splitSig(await ethSign(hash, userAcc))
		// @TODO: set gasLimit manually
		const receipt = await (await id.execute([relayerTx.toSolidityTuple()], [sig])).wait()
		assert.equal(await id.privileges(userAcc), 4, 'privilege level changed')
		//console.log(receipt)
		//console.log(receipt.gasUsed.toString(10))
		// @TODO test if setAddrPrivilege CANNOT be invoked from anyone else
		// @TODO test wrong nonce
		// @TODO test a few consequtive transactions
		// @TODO test wrong sig
	})

	it('relay routine operations', async function() {
		const userAcc = accounts[4]
		const authorization = new RoutineAuthorization({
			identityContract: id.address,
			relayer: accounts[3],
			outpace: accounts[3], // @TODO deploy an outpace
			feeTokenAddr: token.address,
			feeTokenAmount: 0, // @TODO temp
		})
		const hash = authorization.hashHex();
		const sig = splitSig(await ethSign(hash, userAcc))
		// @TODO convenience method to generate a op
		let opData = idInterface.functions.withdraw.encode([token.address, userAcc, 100])
		opData = '0x'+opData.slice(10)
		const op = [
			2,
			opData,
		]
		// @TODO: warn about gasLimit in docs, since estimateGas apparently does not calculate properly
		const receipt = await (await id.executeRoutines(
			authorization.toSolidityTuple(),
			sig,
			[op],
			{ gasLimit: 500000 }
		)).wait()
		console.log(receipt)
		assert.equal(await token.balanceOf(userAcc), 100, 'user has the right balance')
		// @TODO fee gets paid only once
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
