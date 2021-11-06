const { AbiCoder, hexlify, arrayify, keccak256 } = require('ethers').utils
const { Contract } = require('ethers')

const ensure = require('./ensureTypes')

const IdentityInterface = require('../abi/Identity5.2')
const QuickAccManagerInterface = require('../abi/QuickAccManager')

function Bundle(args) {
	this.identity = ensure.Address(args.identity)
	this.network = args.network
	// @TODO validate this
	this.signer = args.signer
	this.txns = args.txns
	this.gasLimit = args.gasLimit
	this.nonce = args.nonce
	this.signature = args.signature
	return this
}

Bundle.prototype.getNonce = async function(provider) {
	this.nonce = await getNonce(provider, this)
	return this.nonce
}

Bundle.prototype.estimate = async function({ fetch, relayerURL }) {
	const res = await fetchPost(
		fetch,
		`${relayerURL}/identity/${this.identity}/${this.network}/estimate`,
		{ txns: this.txns, signer: this.signer }
	)
	this.gasLimit = res.gasLimit
	return res
}

Bundle.prototype.sign = async function(wallet) {
	if (isNaN(this.nonce)) throw new Error('nonce is not set')
	if (isNaN(this.gasLimit)) throw new Error('gasLimit is not set')
	const encoded = getSignable(this)
	const hash = arrayify(keccak256(encoded))
	const signature = await signMsg(wallet, hash)
	this.signature = signature
	return signature
}

Bundle.prototype.submit = async function({ fetch, relayerURL }) {
	const res = await fetchPost(
		fetch,
		`${relayerURL}/identity/${this.identity}/${this.network}/submit`,
		this
	)
	return res
}

Bundle.prototype.cancel = async function({ fetch, relayerURL }) {
	const res = await fetchPost(
		fetch,
		`${relayerURL}/identity/${this.identity}/${this.network}/cancel`,
		{ nonce: this.nonce, signer: this.signer }
	)
	return res
}

// wallet: wallet provider
// identity: identity addr
// signer: same object as the one we pass to Bundle, either {address} or {quickAccManager,timelock,one,two}
// signatureTwo is optional, only when signer.quickAccManager is used
async function signMsgHash(wallet, identity, signer, msgHash, signatureTwo) {
	if (signer.address) return signMsg(wallet, msgHash)
	if (signer.quickAccManager) {
		const signatureOne = await signMsg(wallet, msgHash)
		// the inner sig is the one that the QuickAccManager interprets by doing an abi.decode and sending each individual signature to isValidSignature
		const abiCoder = new AbiCoder()
		const sigInner = abiCoder.encode(
			['address', 'uint', 'bytes', 'bytes'],
			[identity, signer.timelock, signatureOne, signatureTwo]
		)
		// 02 is the SmartWallet type sig; we're essentially formatting this as a smart wallet type sig, verified by the quickAccManager
		const sig = `${sigInner + abiCoder.encode(['address'], [signer.quickAccManager]).slice(2)}02`
		return sig
	}
	throw new Error(`invalid signer object`)
}

function getSignable(userTxnBundle) {
	const abiCoder = new AbiCoder()
	const signer = userTxnBundle.signer
	if (signer.address)
		return abiCoder.encode(
			['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
			[userTxnBundle.identity, getChainID(userTxnBundle.network), userTxnBundle.nonce, userTxnBundle.txns]
		)
	if (signer.quickAccManager) {
		const accHash = keccak256(
			abiCoder.encode(
				['tuple(uint, address, address)'],
				[[userTxnBundle.signer.timelock, userTxnBundle.signer.one, userTxnBundle.signer.two]]
			)
		)
		// @TODO typed data
		// if (signer.isTypedData)
		return abiCoder.encode(
			['address', 'uint', 'bytes32', 'uint', 'tuple(address, uint, bytes)[]', 'bool'],
			[userTxnBundle.identity, getChainID(userTxnBundle.network), accHash, userTxnBundle.nonce, userTxnBundle.txns, true]
		)
	}
	throw new Error(`invalid signer object`)
}

function getChainID(network) {
	if (network === 'ethereum') return 0
	if (network === 'polygon') return 137
	if (network === 'bsc') return 56
	if (network === 'fantom') return 250
	if (network === 'avalanache') return 43114
	throw new Error(`unsupproted network ${network}`)
}

function mapSignatureV(sigRaw) {
	const sig = arrayify(sigRaw)
	if (sig[64] < 27) sig[64] += 27
	return hexlify(sig)
}

async function signMsg(wallet, hash) {
	// assert.equal(hash.length, 32, 'hash must be 32byte array buffer')
	// 01 is the enum number of EthSign signature type
	return `${mapSignatureV(await wallet.signMessage(hash))}01`
}

async function getNonce(provider, userTxnBundle) {
	try {
		return (userTxnBundle.signer.quickAccManager
			? await new Contract(
					userTxnBundle.signer.quickAccManager,
					QuickAccManagerInterface,
					provider
			  ).nonces(userTxnBundle.identity)
			: await new Contract(userTxnBundle.identity, IdentityInterface, provider).nonce()
		).toNumber()
	} catch (e) {
		// means the identity isn't deployed, which certainly implies nonce 0
		if (e.code === 'CALL_EXCEPTION' && (await provider.getCode(userTxnBundle.identity)) === '0x')
			return 0
		throw e
	}
}

async function fetchPost(fetch, url, body) {
	const r = await fetch(url, {
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		body: JSON.stringify(body)
	})
	return r.json()
}

// getNonce(require('ethers').getDefaultProvider('homestead'), { identity: '0x23c2c34f38ce66ccc10e71e9bb2a06532d52c5e8', signer: {address: '0x942f9CE5D9a33a82F88D233AEb3292E680230348'}, txns: [] }).then(console.log)

module.exports = { Bundle, signMsgHash, getSignable }
