const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const { Interface } = require('ethers').utils
const ensure = require('./ensureTypes')
const coreABI = require('../abi/AdExCore')

const coreInterface = new Interface(coreABI)

function Transaction(args) {
	this.identityContract = ensure.Address(args.identityContract)
	this.nonce = ensure.Uint256(args.nonce)
	this.feeTokenAddr = ensure.Address(args.feeTokenAddr)
	this.feeAmount = ensure.Uint256(args.feeAmount)
	this.to = ensure.Address(args.to)
	this.value = ensure.Uint256(args.value)
	this.data = ensure.Bytes(args.data)
	Object.freeze(this)
	return this
}

Transaction.prototype.hash = function() {
	const buf = abi.rawEncode(
		['address', 'uint256', 'address', 'uint256', 'address', 'uint256', 'bytes'],
		[
			this.identityContract,
			this.nonce,
			this.feeTokenAddr,
			this.feeAmount,
			this.to,
			this.value,
			this.data
		]
	)
	return Buffer.from(keccak256.arrayBuffer(buf))
}

Transaction.prototype.hashHex = function() {
	return `0x${this.hash().toString('hex')}`
}

Transaction.prototype.toSolidityTuple = function() {
	// etherjs doesn't seem to want BN.js instances; hex is the lowest common denominator for web3/ethers
	return [
		this.identityContract,
		`0x${this.nonce.toString(16)}`,
		this.feeTokenAddr,
		`0x${this.feeAmount.toString(16)}`,
		this.to,
		`0x${this.value.toString(16)}`,
		`0x${this.data.toString('hex')}`
	]
}

function RoutineAuthorization(args) {
	this.relayer = ensure.Address(args.relayer)
	this.outpace = ensure.Address(args.outpace)
	this.validUntil = ensure.Uint256(args.validUntil)
	this.feeTokenAddr = ensure.Address(args.feeTokenAddr)
	this.weeklyFeeAmount = ensure.Uint256(args.weeklyFeeAmount)
	Object.freeze(this)
	return this
}

RoutineAuthorization.prototype.hash = function() {
	const buf = abi.rawEncode(
		['address', 'address', 'uint256', 'address', 'uint256'],
		[this.relayer, this.outpace, this.validUntil, this.feeTokenAddr, this.weeklyFeeAmount]
	)
	return Buffer.from(keccak256.arrayBuffer(buf))
}

RoutineAuthorization.prototype.hashHex = function() {
	return `0x${this.hash().toString('hex')}`
}

RoutineAuthorization.prototype.toSolidityTuple = function() {
	// etherjs doesn't seem to want BN.js instances; hex is the lowest common denominator for web3/ethers
	return [
		this.relayer,
		this.outpace,
		`0x${this.validUntil.toString(16)}`,
		this.feeTokenAddr,
		`0x${this.weeklyFeeAmount.toString(16)}`
	]
}

const RoutineOps = {
	channelWithdraw(args) {
		const data = `0x${coreInterface.functions.channelWithdraw.encode(args).slice(10)}`
		return [0, data]
	},
	channelWithdrawExpired(args) {
		const data = `0x${coreInterface.functions.channelWithdrawExpired.encode(args).slice(10)}`
		return [1, data]
	}
}

function WithdrawnPerChannel(channels, amountsWithdrawn) {
	if (channels.length !== amountsWithdrawn.length) throw new Error('invalid withdrawn')

	this.channels = channels
	this.amountsWithdrawnPerChannel = amountsWithdrawn
}

WithdrawnPerChannel.prototype.toSolidityTuple = function(coreV2Addr) {
	return this.channels.map((item, i) => [
		item.hashHex(coreV2Addr),
		this.amountsWithdrawnPerChannel[i]
	])
}

WithdrawnPerChannel.prototype.computeMerkleRoot = function(sender) {
	let amountLength = this.amountsWithdrawnPerChannel.length
	if (amountLength === 0) {
		return Buffer.from(0)
	}

	if (amountLength === 1) {
		return hashNode(sender, this.amountsWithdrawnPerChannel[0])
	}

	const merkleTree = []

	while (amountLength > 1) {
		let nNext = amountLength / 2
		for (let i = 0; i < nNext; i += 1) {
			const curr = i * 2
			merkleTree.push(
				hashLeafPair(
					hashNode(sender, this.amountsWithdrawnPerChannel[curr]),
					hashNode(sender, this.amountsWithdrawnPerChannel[curr + 1])
				)
			)
		}

		if (amountLength % 2 === 1) {
			nNext += 1
			merkleTree[nNext - 1] = merkleTree[amountLength - 1]
		}
		amountLength = nNext
	}

	return merkleTree[0]
}

WithdrawnPerChannel.prototype.computeMerkleRootHex = function(sender) {
	return `0x${this.computeMerkleRoot(sender).toString('hex')}`
}

function hashNode(address, balance) {
	const buf = abi.rawEncode(
		['address', 'uint256'],
		[ensure.Address(address), ensure.Uint256(balance)]
	)
	return Buffer.from(keccak256.arrayBuffer(buf))
}

function hashLeafPair(left, right) {
	const buf = abi.rawEncode(['bytes32', 'bytes32'], [ensure.Bytes32(left), ensure.Bytes32(right)])
	return Buffer.from(keccak256.arrayBuffer(buf))
}

module.exports = { Transaction, RoutineAuthorization, RoutineOps, WithdrawnPerChannel }

// jwtzlz
