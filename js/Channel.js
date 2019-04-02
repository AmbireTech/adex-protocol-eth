const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const ensure = require('./ensureTypes')

const ChannelState = {
	Unknown: 0,
	Active: 1,
	Expired: 2
}

function Channel(args) {
	this.creator = ensure.Address(args.creator)

	this.tokenAddr = ensure.Address(args.tokenAddr)
	this.tokenAmount = ensure.Uint256(args.tokenAmount)

	this.validUntil = ensure.Uint256(args.validUntil)

	this.validators = Array.isArray(args.validators) ? args.validators.map(ensure.Address) : []

	this.spec = ensure.Bytes32(args.spec)

	Object.freeze(this.validators)
	Object.freeze(this)

	return this
}

Channel.prototype.hash = function(contractAddr) {
	// contains contractAddr, so that it's not replayable
	if (!contractAddr) throw new Error('contractAddr required')
	return Buffer.from(
		keccak256.arrayBuffer(
			abi.rawEncode(
				['address', 'address', 'address', 'uint256', 'uint256', 'address[]', 'bytes32'],
				[
					contractAddr,
					this.creator,
					this.tokenAddr,
					this.tokenAmount,
					this.validUntil,
					this.validators,
					this.spec
				]
			)
		)
	)
}

Channel.prototype.hashHex = function(contractAddr) {
	return `0x${this.hash(contractAddr).toString('hex')}`
}

Channel.prototype.toSolidityTuple = function() {
	// etherjs doesn't seem to want BN.js instances; hex is the lowest common denominator for web3/ethers
	return [
		this.creator,
		this.tokenAddr,
		`0x${this.tokenAmount.toString(16)}`,
		`0x${this.validUntil.toString(16)}`,
		this.validators,
		this.spec
	]
}

Channel.prototype.hashToSign = function(contractAddr, balanceRoot) {
	// contains the channel hash (channelId), so that it's not replayable
	return Channel.getSignableStateRoot(this.hashHex(contractAddr), balanceRoot)
}

Channel.prototype.hashToSignHex = function(contractAddr, stateRoot) {
	return `0x${this.hashToSign(contractAddr, stateRoot).toString('hex')}`
}

// This returns the same as .hashToSign, .hashToSignHex, but it takes the channelId rather than (the whole channel + contract addr)
Channel.getSignableStateRoot = function(channelId, balanceRoot) {
	return Buffer.from(
		keccak256.arrayBuffer(abi.rawEncode(['bytes32', 'bytes32'], [channelId, balanceRoot]))
	)
}

Channel.getBalanceLeaf = function(acc, amnt) {
	return Buffer.from(keccak256.arrayBuffer(abi.rawEncode(['address', 'uint256'], [acc, amnt])))
}

module.exports = { Channel, ChannelState }
