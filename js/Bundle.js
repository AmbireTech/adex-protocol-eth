const { AbiCoder, hexlify, arrayify, keccak256 } = require('ethers').utils
const { Contract } = require('ethers')

const ensure = require('./ensureTypes')

const IdentityInterface = require('../abi/Identity5.2')
const IdentityFactoryInterface = require('../abi/IdentityFactory5.2')
const QuickAccManagerInterface = require('../abi/QuickAccManager')

function Bundle(args) {
	this.identity = ensure.Address(args.identity)
	this.network = args.network
	// @TODO validate this
	this.signer = args.signer
	this.txns = args.txns
	return this
}

Bundle.prototype.getNonce = async function(provider) {
	this.nonce = await getNonce(provider, this)
	return this.nonce
}

Bundle.prototype.estimate = async function({ fetch, relayerURL }) {
	const res = await fetchPost(fetch, `${relayerURL}/identity/${this.identity}/${this.network}/estimate`, { txns: this.txns, signer: this.signer })
	this.gasLimit = res.gasLimit
	return res
}

Bundle.prototype.sign = async function(wallet) {
	// @TODO quickAccount
	const signature = await signMsg(wallet, hashTxns(this.identity, this.network, this.nonce, this.txns))
	this.signature = signature
	return signature
}

Bundle.prototype.submit = async function({ fetch, relayerURL }) {
	const res = await fetchPost(fetch, `${relayerURL}/identity/${this.identity}/${this.network}/submit`, this)

}

function hashTxns (identityAddr, chainId, nonce, txns) {
	const abiCoder = new AbiCoder()
	const encoded = abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [identityAddr, chainId, nonce, txns])
	return arrayify(keccak256(encoded))
}

function mapSignatureV (sig) {
	sig = arrayify(sig)
	if (sig[64] < 27) sig[64] += 27
	return hexlify(sig)
}

async function signMsg (wallet, hash) {
	//assert.equal(hash.length, 32, 'hash must be 32byte array buffer')
	// 02 is the enum number of EthSign signature type
	return mapSignatureV(await wallet.signMessage(hash)) + '02'
}

async function getNonce (provider, userTxnBundle) {
	try {
		return (userTxnBundle.signer.quickAccManager
			? (await (new Contract(userTxnBundle.signer.quickAccManager, QuickAccManagerInterface, provider)).nonces(userTxnBundle.identity))
			: (await (new Contract(userTxnBundle.identity, IdentityInterface, provider)).nonce())
		).toNumber()
	} catch(e) {
		// means the identity isn't deployed, which certainly implies nonce 0
		if (e.code === 'CALL_EXCEPTION' && (await provider.getCode(userTxnBundle.identity)) === '0x') return 0
		else throw e
	}
}

async function fetchPost (fetch, url, body) {
	const r = await fetch(url, {
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		body: JSON.stringify(body)
	})
	return r.json()
}

//getNonce(require('ethers').getDefaultProvider('homestead'), { identity: '0x23c2c34f38ce66ccc10e71e9bb2a06532d52c5e8', signer: {address: '0x942f9CE5D9a33a82F88D233AEb3292E680230348'}, txns: [] }).then(console.log)

module.exports = { Bundle }

