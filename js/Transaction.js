const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const ensure = require('./ensureTypes')

function Transaction(args) {
	this.identityContract = ensure.Address(args.identityContract)
	this.nonce = ensure.Uint256(args.nonce)
	this.feeTokenAddr = ensure.Address(args.feeTokenAddr)
	this.feeTokenAmount = ensure.Uint256(args.feeTokenAmount)
	this.to = ensure.Address(args.to)
	this.value = ensure.Uint256(args.value)
	this.data = ensure.Bytes(args.data)
	Object.freeze(this)
	return this
}

Transaction.prototype.hash = function() {
	const buf = abi.rawEncode(
		['address', 'uint256', 'address', 'uint256', 'address', 'uint256', 'bytes'],
		[this.identityContract, this.nonce, this.feeTokenAddr, this.feeTokenAmount, this.to, this.value, this.data],
	)
	return new Buffer(keccak256.arrayBuffer(buf))
}

Transaction.prototype.hashHex = function() {
	return '0x'+this.hash().toString('hex')
}

Transaction.prototype.toSolidityTuple = function() {
	// etherjs doesn't seem to want BN.js instances; hex is the lowest common denominator for web3/ethers
	return [this.identityContract, '0x'+this.nonce.toString(16), this.feeTokenAddr, '0x'+this.feeTokenAmount.toString(16), this.to, '0x'+this.value.toString(16), '0x'+this.data.toString('hex')]
}



function RoutineAuthorization(args) {
	this.identityContract = ensure.Address(args.identityContract)
	this.relayer = ensure.Address(args.relayer)
	this.outpace = ensure.Address(args.outpace)
	this.validUntil = ensure.Uint256(args.validUntil)
	this.feeTokenAddr = ensure.Address(args.feeTokenAddr)
	this.feeTokenAmount = ensure.Uint256(args.feeTokenAmount)
	Object.freeze(this)
	return this
}

RoutineAuthorization.prototype.hash = function() {
	const buf = abi.rawEncode(
		['address', 'address', 'address', 'uint256', 'address', 'uint256'],
		[this.identityContract, this.relayer, this.outpace, this.validUntil, this.feeTokenAddr, this.feeTokenAmount],
	)
	return new Buffer(keccak256.arrayBuffer(buf))
}

RoutineAuthorization.prototype.hashHex = function() {
	return '0x'+this.hash().toString('hex')
}

RoutineAuthorization.prototype.toSolidityTuple = function() {
	// etherjs doesn't seem to want BN.js instances; hex is the lowest common denominator for web3/ethers
	return [this.identityContract, this.relayer, this.outpace, '0x'+this.validUntil.toString(16), this.feeTokenAddr, '0x'+this.feeTokenAmount.toString(16)]
}


module.exports = { Transaction, RoutineAuthorization }
