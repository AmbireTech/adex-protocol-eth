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
	this.registry = ensure.Address(args.registry)
	this.validUntil = ensure.Uint256(args.validUntil)
	this.feeTokenAddr = ensure.Address(args.feeTokenAddr)
	this.weeklyFeeAmount = ensure.Uint256(args.weeklyFeeAmount)
	Object.freeze(this)
	return this
}

RoutineAuthorization.prototype.hash = function() {
	const buf = abi.rawEncode(
		['address', 'address', 'address', 'uint256', 'address', 'uint256'],
		[
			this.relayer,
			this.outpace,
			this.registry,
			this.validUntil,
			this.feeTokenAddr,
			this.weeklyFeeAmount
		]
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
		this.registry,
		`0x${this.validUntil.toString(16)}`,
		this.feeTokenAddr,
		`0x${this.weeklyFeeAmount.toString(16)}`
	]
}

const RoutineOps = {
	// @TODO is there a more elegant way to remove the SELECTOR than .slice(10)?
	channelWithdraw(args) {
		const data = `0x${coreInterface.functions.channelWithdraw.encode(args).slice(10)}`
		return [0, data]
	},
	channelWithdrawExpired(args) {
		const data = `0x${coreInterface.functions.channelWithdrawExpired.encode(args).slice(10)}`
		return [1, data]
	},
	channelOpen(args) {
		const data = `0x${coreInterface.functions.channelOpen.encode(args).slice(10)}`
		return [2, data]
	},
	withdraw(tokenAddr, to, amount) {
		return [3, abi.rawEncode(['address', 'address', 'uint256'], [tokenAddr, to, amount])]
	}
}

module.exports = { Transaction, RoutineAuthorization, RoutineOps }
