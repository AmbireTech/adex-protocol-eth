const promisify = require('util').promisify
const { keccak256 } = require('ethers').utils
const abi = require('ethereumjs-abi')
const { Transaction, Channel, splitSig, MerkleTree } = require('../js')

const ethSign = promisify(web3.eth.sign.bind(web3))

async function getWithdrawData(channel, id, addresses, tokenAmnt, outpaceAddr) {
	const elems = addresses.map(addr => {
		return Channel.getBalanceLeaf(addr, tokenAmnt)
	})
	const idElem = Channel.getBalanceLeaf(id, tokenAmnt)
	const tree = new MerkleTree(elems)
	const proof = tree.proof(idElem)
	const stateRoot = tree.getRoot()
	const channelId = keccak256(
		abi.rawEncode(['address', 'address', 'address', 'address', 'bytes32'], channel)
	)
	const hashToSignHex = keccak256(
		abi.rawEncode(['address', 'bytes32', 'bytes32'], [outpaceAddr, channelId, stateRoot])
	)
	const [sig1, sig2] = await Promise.all(channel.slice(0, 2).map(v => ethSign(hashToSignHex, v)))
	return [stateRoot, splitSig(sig1), splitSig(sig2), proof]
}

async function zeroFeeTx(to, data, nonceOffset = 0, id, token) {
	return new Transaction({
		identityContract: id.address,
		nonce: (await id.nonce()).toNumber() + nonceOffset,
		feeTokenAddr: token.address,
		feeAmount: 0,
		to,
		data
	})
}

module.exports = { getWithdrawData, zeroFeeTx, ethSign }
