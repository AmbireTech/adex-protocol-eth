const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const ensure = require('./ensureTypes')

const ChannelState = {
	Unknown: 0,
	Active: 1,
	Expired: 2
}

function Channel(args) {
	this.leader = ensure.Address(args.leader)
	this.follower = ensure.Address(args.follower)
	this.guardian = ensure.Address(args.guardian)
	this.tokenAddr = ensure.Address(args.tokenAddr)
	this.nonce = ensure.Bytes32(args.nonce)

	Object.freeze(this)

	return this
}

Channel.prototype.hash = function() {
	return Buffer.from(
		keccak256.arrayBuffer(
			abi.rawEncode(
				['address', 'address', 'address', 'address', 'bytes32'],
				[this.leader, this.follower, this.guardian, this.tokenAddr, this.nonce]
			)
		)
	)
}

Channel.prototype.hashHex = function() {
	return `0x${this.hash().toString('hex')}`
}

Channel.prototype.toSolidityTuple = function() {
	// etherjs doesn't seem to want BN.js instances; hex is the lowest common denominator for web3/ethers
	return [this.leader, this.follower, this.guardian, this.tokenAddr, this.nonce]
}

Channel.prototype.hashToSign = function(contractAddr, balanceRoot) {
	// contains the channel hash (channelId), so that it's not replayable
	return Channel.getSignableStateRoot(contractAddr, this.hashHex(), balanceRoot)
}

Channel.prototype.hashToSignHex = function(contractAddr, stateRoot) {
	return `0x${this.hashToSign(contractAddr, stateRoot).toString('hex')}`
}

Channel.prototype.getResumeSignableRoot = function(challengeExpires) {
	return Buffer.from(
		keccak256.arrayBuffer(
			abi.solidityPack(
				['string', 'bytes32', 'uint256'],
				['resume', this.hashHex(), challengeExpires]
			)
		)
	)
}

Channel.prototype.getResumeSignableRootHex = function(challengeExpires) {
	return `0x${this.getResumeSignableRoot(challengeExpires).toString('hex')}`
}

// This returns the same as .hashToSign, .hashToSignHex, but it takes the channelId rather than (the whole channel + contract addr)
Channel.getSignableStateRoot = function(contractAddr, channelId, balanceRoot) {
	return Buffer.from(
		keccak256.arrayBuffer(
			abi.rawEncode(['address', 'bytes32', 'bytes32'], [contractAddr, channelId, balanceRoot])
		)
	)
}

Channel.getBalanceLeaf = function(acc, amnt) {
	return Buffer.from(keccak256.arrayBuffer(abi.rawEncode(['address', 'uint256'], [acc, amnt])))
}

module.exports = { Channel, ChannelState }
