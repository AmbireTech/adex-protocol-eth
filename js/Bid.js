const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const ensure = require('./ensureTypes')

const SCHEMA_HASH = '0xf05a6d38810408971c1e2a9cd015fefd95aaae6d0c1a25da4ed10c1ac77ebb64'

function Bid(args) {
	this.advertiser = ensure.Address(args.advertiser)
	this.adUnit = ensure.Bytes32(args.adUnit)
	this.goal = ensure.Bytes32(args.goal)
	this.timeout = ensure.Uint256(args.timeout)
	this.tokenAddr = ensure.Address(args.tokenAddr)
	this.tokenAmount = ensure.Uint256(args.tokenAmount)
	this.nonce = ensure.Uint256(args.nonce)
	this.validators = Array.isArray(args.validators) ? args.validators.map(ensure.Address) : []
	this.validatorRewards = Array.isArray(args.validatorRewards) ? args.validatorRewards.map(ensure.Uint256) : []

	Object.freeze(this.validators)
	Object.freeze(this.validatorRewards)
	Object.freeze(this)

	return this
}

// returns all the scalar values, as hex strings prefixed with 0x
Bid.prototype.values = function() {
	const num = x => '0x' + x.toString(16, 64)
	const hex = x => '0x' + ('0000000000000000000000000000000000000000000000000000000000000000'.concat(x.slice(2)).slice(-64))
	return [hex(this.advertiser), hex(this.adUnit), hex(this.goal), num(this.timeout), hex(this.tokenAddr), num(this.tokenAmount), num(this.nonce)]
}

Bid.prototype.hash = function(coreAddr) {
	if (!coreAddr) throw 'coreAddr needs to be supplied'
	const buf = keccak256(abi.rawEncode(
		['bytes32', 'address', 'address', 'bytes32', 'bytes32', 'uint256', 'address', 'uint256', 'uint256', 'address[]', 'uint256[]'],
		[SCHEMA_HASH, coreAddr, this.advertiser, this.adUnit, this.goal, this.timeout, this.tokenAddr, this.tokenAmount, this.nonce, this.validators, this.validatorRewards]
	))
	return '0x'+buf.toString(16)
}

const BidState = {
	Unknown: 0,
	Active: 1,
	Canceled: 2,
	DeliveryTimedOut: 3,
	DeliveryFailed: 4,
	DeliverySucceeded: 5
}

module.exports = { Bid, BidState, SCHEMA_HASH }
