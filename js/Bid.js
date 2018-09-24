const keccak256 = require('js-sha3').keccak256
const ethereumAbi = require('ethereumjs-abi')

const SCHEMA_HASH = '0xf05a6d38810408971c1e2a9cd015fefd95aaae6d0c1a25da4ed10c1ac77ebb64'

// @TODO copy into Commitment.js

function Bid(args) {
	// @TODO is it possible to enforce types here
	this.advertiser = args.advertiser
	this.adUnit = args.adUnit
	this.goal = args.goal
	this.timeout = args.timeout
	this.tokenAddr = args.tokenAddr
	this.tokenAmount = args.tokenAmount
	this.nonce = args.nonce
	this.validators = Array.isArray(args.validators) ? args.validators : []
	this.validatorRewards = Array.isArray(args.validatorRewards) ? args.validatorRewards : []
}

// @TODO: decode from ethereum ABI
// @TODO: encode to ethereum ABI

Bid.prototype.hash = function() {
	// @TODO
}

module.exports = Bid