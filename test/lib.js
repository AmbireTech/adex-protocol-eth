const promisify = require('util').promisify
const { Contract, Wallet } = require('ethers')

const { Transaction, Channel, splitSig, MerkleTree, RoutineAuthorization } = require('../js')
const { sampleChannel } = require('./')
const ensure = require('../js/ensureTypes')

const ethSign = promisify(web3.eth.sign.bind(web3))

async function getWithdrawData(channel, id, addresses, tokenAmnt, coreAddr) {
	const elems = addresses.map(addr => {
		return Channel.getBalanceLeaf(addr, tokenAmnt)
	})
	const idElem = Channel.getBalanceLeaf(id, tokenAmnt)
	const tree = new MerkleTree(elems)
	const proof = tree.proof(idElem)
	const stateRoot = tree.getRoot()
	const hashToSignHex = channel.hashToSignHex(coreAddr, stateRoot)
	const [sig1, sig2] = await Promise.all(channel.validators.map(v => ethSign(hashToSignHex, v)))
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

// generate random address
function getRandomAddresses(size) {
	const addresses = []
	for (let i = 0; i < size; i += 1) {
		const wallet = Wallet.createRandom()
		addresses.push(wallet.address)
	}
	return addresses
}

function getRandomNumberWithinRange(min, max) {
	return Math.random() * (max - min) + min
}

const DAY_SECONDS = 24 * 60 * 60

function V2Lib({ coreV2Addr, relayerAddr, userAcc, gasLimit, id, token, idInterface }) {
	this.coreV2Addr = ensure.Address(coreV2Addr)
	this.relayerAddr = ensure.Address(relayerAddr)
	this.userAcc = ensure.Address(userAcc)
	this.gasLimit = gasLimit
	this.identity = id
	this.token = token
	this.idInterface = idInterface
}

V2Lib.prototype.openV2Channel = async function({
	channelNonce,
	tokenAmnt = 500,
	validators,
	validUntil
}) {
	const blockTime = (await web3.eth.getBlock('latest')).timestamp
	const channel = sampleChannel(
		validators,
		this.token.address,
		this.identity.address,
		tokenAmnt,
		validUntil || blockTime + 40 * DAY_SECONDS,
		channelNonce + 10000 // to make channel unique
	)
	const txns = [
		await zeroFeeTx(
			this.identity.address,
			this.idInterface.functions.channelOpen.encode([this.coreV2Addr, channel.toSolidityTuple()]),
			0,
			this.identity,
			this.token
		)
	]

	const sigs = await Promise.all(
		txns.map(async tx => splitSig(await ethSign(tx.hashHex(), this.userAcc)))
	)
	const receipt = await (await this.identity.execute(txns.map(x => x.toSolidityTuple()), sigs, {
		gasLimit: this.gasLimit
	})).wait()

	return { channel, receipt }
}

V2Lib.prototype.setV2RoutineAuth = async function({ fee = 20 }) {
	const blockTime = (await web3.eth.getBlock('latest')).timestamp
	const auth = new RoutineAuthorization({
		relayer: this.relayerAddr,
		outpace: this.coreV2Addr,
		validUntil: blockTime + 14 * DAY_SECONDS,
		feeTokenAddr: this.token.address,
		weeklyFeeAmount: fee
	})
	const txns = [
		await zeroFeeTx(
			this.identity.address,
			this.idInterface.functions.setRoutineAuth.encode([auth.hashHex(), true]),
			0,
			this.identity,
			this.token
		)
	]

	const sigs = await Promise.all(
		txns.map(async tx => splitSig(await ethSign(tx.hashHex(), this.userAcc)))
	)
	await (await this.identity.execute(txns.map(x => x.toSolidityTuple()), sigs, {
		gasLimit: this.gasLimit
	})).wait()
}

V2Lib.prototype.newIdentityContract = async function({ web3Provider, Identity }) {
	const signer = web3Provider.getSigner(this.relayerAddr)
	const idWeb3 = await Identity.new([this.userAcc], [2])
	await this.token.setBalanceTo(idWeb3.address, 100000000000)

	return new Contract(idWeb3.address, Identity._json.abi, signer)
}

module.exports = {
	getWithdrawData,
	zeroFeeTx,
	ethSign,
	getRandomAddresses,
	getRandomNumberWithinRange,
	V2Lib,
	DAY_SECONDS
}
