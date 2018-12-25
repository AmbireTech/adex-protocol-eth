const Identity = artifacts.require('Identity')

const { Transaction } = require('../js/Transaction')
const { splitSig } = require('../js')

const promisify = require('util').promisify
const ethSign = promisify(web3.eth.sign.bind(web3))

const { providers, Contract } = require('ethers')
const Interface = require('ethers').utils.Interface
const web3Provider = new providers.Web3Provider(web3.currentProvider)

contract('Identity', function(accounts) {
	let id
	let idInterface = new Interface(Identity._json.abi)

	before(async function() {
		// 3 is the relayer, 4 is the acc
		const signer = web3Provider.getSigner(accounts[3])
		const idWeb3 = await Identity.new(accounts[4], 3)
		id = new Contract(idWeb3.address, Identity._json.abi, signer)
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
		const receipt = await (await id.execute([relayerTx.toSolidityTuple()], [sig])).wait()
		assert.equal(await id.privileges(userAcc), 4, 'privilege level changed')
		//console.log(receipt)
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
