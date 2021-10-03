const { AbiCoder, hexlify, arrayify, keccak256 } = require('ethers').utils
const ensure = require('./ensureTypes')

function Bundle(args) {
	this.identity = ensure.Address(args.identity)
	// @TODO
	this.signer = args.signer

	Object.freeze(this)
	return this
}

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

async function signMsg(wallet, hash) {
	//assert.equal(hash.length, 32, 'hash must be 32byte array buffer')
	// 02 is the enum number of EthSign signature type
	return mapSignatureV(await wallet.signMessage(hash)) + '02'
}

module.exports = { Bundle }

