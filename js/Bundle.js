const { AbiCoder, hexlify, arrayify, keccak256, Interface } = require('ethers').utils
const { Contract, BigNumber } = require('ethers')

const ensure = require('./ensureTypes')

const IdentityABI = require('../abi/Identity5.2')
const QuickAccManagerABI = require('../abi/QuickAccManager')

const IdentityInterface = new Interface(IdentityABI)

function Bundle(args) {
	this.identity = ensure.Address(args.identity)
	this.network = args.network
	// @TODO validate this
	this.signer = args.signer
	this.txns = args.txns
	this.gasLimit = args.gasLimit
	this.nonce = args.nonce
	this.signature = args.signature
	this.minFeeInUSDPerGas = args.minFeeInUSDPerGas
	this.recoveryMode = args.recoveryMode
	this.meta = args.meta
	this.gasTankFee = args.gasTankFee
	return this
}

Bundle.prototype.getNonce = async function(provider) {
	this.nonce = await getNonce(provider, this)
	return this.nonce
}

Bundle.prototype.estimate = async function({ fetch, relayerURL, replacing, getNextNonce }) {
	const res = await fetchPost(
		fetch,
		`${relayerURL}/identity/${this.identity}/${this.network}/estimate${
			getNextNonce ? '?getNextNonce=true' : ''
		}`,
		{ txns: this.txns, signer: this.signer, replacing, minFeeInUSDPerGas: this.minFeeInUSDPerGas }
	)
	this.gasLimit = res.gasLimit
	return res
}

Bundle.prototype.sign = async function(wallet, isSingleSigMode) {
	if (isNaN(this.nonce)) throw new Error('nonce is not set')
	if (isNaN(this.gasLimit)) throw new Error('gasLimit is not set')
	const encoded = getSignable(this, isSingleSigMode)
	const hash = arrayify(keccak256(encoded))
	const signature = await signMsg(wallet, hash)
	this.signature = signature
	return signature
}

Bundle.prototype.submit = async function({ fetch, relayerURL }) {
	const res = await fetchPost(
		fetch,
		`${relayerURL}/identity/${this.identity}/${this.network}/submit`,
		{
			nonce: this.nonce,
			signer: this.signer,
			txns: this.txns,
			gasLimit: this.gasLimit,
			signature: this.signature,
			signatureTwo: this.signatureTwo,
			meta: this.meta,
			gasTankFee: this.gasTankFee
		}
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

const UNPREDICTABLE_GAS_REGEX = /gas required exceeds allowance|always failing transaction|execution reverted/
Bundle.prototype.estimateNoRelayer = async function({ provider, replacing }) {
	const txParams = {
		from: this.signer.quickAccManager || this.signer.address,
		to: this.identity,
		data: IdentityInterface.encodeFunctionData('executeBySender', [this.txns])
	}
	const blockTag = replacing ? 'latest' : 'pending'
	const { error, gasLimit } = await estimateGasWithCatch(provider, blockTag, txParams)
	if (error && error.message.startsWith('execution reverted: ')) {
		const message = error.message.slice(20)
		return { success: false, message }
	}
	if (error) {
		// Match both the code and the regex to handle both errs from ethers and raw ones from nodes in case we use .send
		if (!(error.code === 'UNPREDICTABLE_GAS_LIMIT' || error.message.match(UNPREDICTABLE_GAS_REGEX)))
			throw error
		return { success: false, message: await getErrMsg(provider, txParams, blockTag) }
	}
	this.gasLimit = gasLimit.toNumber()
	// @TODO EIP1559-optimized estimations (good first issue for external contributors)
	const feeData = await provider.getFeeData()
	const gasPrice = feeData.gasPrice.toNumber()
	const baseFee = (gasPrice * gasLimit) / 1e18
	return {
		success: true,
		gasLimit: this.gasLimit,
		gasPrice,
		feeInNative: {
			slow: baseFee * 0.9,
			medium: baseFee * 1.0,
			fast: baseFee * 1.15,
			ape: baseFee * 1.4
		}
	}
}

async function signMessage(wallet, identity, signer, message, signatureTwo) {
	if (signer.address) return signMsg(wallet, message, true)
	if (signer.quickAccManager) {
		const signatureOne = await signMsg(wallet, message, true)
		// the inner sig is the one that the QuickAccManager interprets by doing an abi.decode and sending each individual signature to isValidSignature
		const abiCoder = new AbiCoder()
		const sigInner = abiCoder.encode(
			['uint', 'bytes', 'bytes'],
			[signer.timelock, signatureOne, signatureTwo]
		)
		// 02 is the SmartWallet type sig; we're essentially formatting this as a smart wallet type sig, verified by the quickAccManager
		const sig = `${sigInner + abiCoder.encode(['address'], [signer.quickAccManager]).slice(2)}02`
		return sig
	}
	throw new Error(`invalid signer object`)
}


async function signMessage712(wallet, identity, signer, domain, types, value, signatureTwo) {
	if (signer.address) return signMsg712(wallet, domain, types, value)
	if (signer.quickAccManager) {
		const signatureOne = await signMsg712(wallet, domain, types, value)
		// the inner sig is the one that the QuickAccManager interprets by doing an abi.decode and sending each individual signature to isValidSignature
		const abiCoder = new AbiCoder()
		const sigInner = abiCoder.encode(
			['uint', 'bytes', 'bytes'],
			[signer.timelock, signatureOne, signatureTwo]
		)
		// 02 is the SmartWallet type sig; we're essentially formatting this as a smart wallet type sig, verified by the quickAccManager
		const sig = `${sigInner + abiCoder.encode(['address'], [signer.quickAccManager]).slice(2)}02`
		return sig
	}
	throw new Error(`invalid signer object`)
}

function getSignable(userTxnBundle, isSingleSigMode) {
	const abiCoder = new AbiCoder()
	const signer = userTxnBundle.signer
	if (signer.address)
		return abiCoder.encode(
			['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
			[
				userTxnBundle.identity,
				getChainID(userTxnBundle.network),
				userTxnBundle.nonce,
				userTxnBundle.txns
			]
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
			['address', 'uint', 'address', 'bytes32', 'uint', 'tuple(address, uint, bytes)[]', 'bool'],
			[
				signer.quickAccManager,
				getChainID(userTxnBundle.network),
				userTxnBundle.identity,
				accHash,
				userTxnBundle.nonce,
				userTxnBundle.txns,
				!isSingleSigMode
			]
		)
	}
	throw new Error(`invalid signer object`)
}

function getChainID(network) {
	if (network === 'ethereum') return 1
	if (network === 'polygon') return 137
	if (network === 'binance-smart-chain') return 56
	if (network === 'bsc') return 56
	if (network === 'fantom') return 250
	if (network === 'avalanche') return 43114
	if (network === 'arbitrum') return 42161
	if (network === 'moonbeam') return 1284
	if (network === 'moonriver') return 1285
	if (network === 'gnosis') return 100
	if (network === 'kucoin') return 321
	if (network === 'andromeda') return 1088
	if (network === 'cronos') return 25
	if (network === 'aurora') return 1313161554
	if (network === 'rinkeby') return 4
	if (network === 'optimism') return 10
	throw new Error(`unsupported network ${network}`)
}

function mapSignatureV(sigRaw) {
	const sig = arrayify(sigRaw)
	if (sig[64] < 27) sig[64] += 27
	return hexlify(sig)
}

async function signMsg(wallet, message, useFinalDigestSigMode = false) {
	// assert.equal(hash.length, 32, 'hash must be 32byte array buffer')
	// was 01 originally but to avoid prefixing in solidity, we changed it to 00
	return `${mapSignatureV(await wallet.signMessage(message))}${useFinalDigestSigMode ? '00' : '01'}`
}

async function signMsg712(wallet, domain, types, value) {
	// 00 is the enum number of SignatureMode.EIP712
	const typedDataSign = await wallet._signTypedData(domain, types, value)
	return `${mapSignatureV(typedDataSign)}00`
}

async function getNonce(provider, userTxnBundle) {
	try {
		return (userTxnBundle.signer.quickAccManager
			? await new Contract(
					userTxnBundle.signer.quickAccManager,
					QuickAccManagerABI,
					provider
			  ).nonces(userTxnBundle.identity)
			: await new Contract(userTxnBundle.identity, IdentityABI, provider).nonce()
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

// helpers for estimateNoRelayer

// Signature of Error(string)
const ERROR_SIG = '0x08c379a0'

async function getErrMsg(provider, txParams, blockTag) {
	// .call always returns a hex string with ethers
	try {
		const returnData = await provider.call(txParams, blockTag)
		return returnData.startsWith(ERROR_SIG)
			? new AbiCoder().decode(['string'], `0x${returnData.slice(10)}`)[0]
			: returnData
	} catch (e) {
		// weird infura case
		if (e.code === 'UNPREDICTABLE_GAS_LIMIT' && e.error) return e.error.message.slice(20)
		if (e.code === 'CALL_EXCEPTION') return 'no error string, possibly insufficient amount'
		if (e.code === 'INVALID_ARGUMENT') return `unable to deserialize: ${hexlify(e.value)}`
		throw e
	}
}

async function estimateGasWithCatch(provider, blockTag, tx) {
	return (
		provider
			.send('eth_estimateGas', [tx, blockTag])
			.then(gasLimit => ({ gasLimit: BigNumber.from(gasLimit) }))
			// with .send, the error is wrapped in another error
			.catch(e => (e.code === 'SERVER_ERROR' ? { error: e.error } : { error: e }))
	)
}

// getNonce(require('ethers').getDefaultProvider('homestead'), { identity: '0x23c2c34f38ce66ccc10e71e9bb2a06532d52c5e8', signer: {address: '0x942f9CE5D9a33a82F88D233AEb3292E680230348'}, txns: [] }).then(console.log)

module.exports = { Bundle, signMessage, signMessage712, getSignable, signMsg, signMsg712 }
