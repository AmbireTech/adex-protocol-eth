const ethereumAbi = require('ethereumjs-abi')

// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md
// @TODO: use eth-sig-util in the tests, so we can conform with what metamask does
// https://github.com/MetaMask/eth-sig-util/blob/master/index.js
// https://github.com/ethereumjs/ethereumjs-abi/blob/master/lib/index.js
const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const ensure = require('./ensureTypes')

const SCHEMA_HASH = '0x8aa1fb0e671ad6f7d73ad552eff29b7b79186e0143b91e48a013151a34ae50dd'

function Commitment(args) {
	this.bidId = ensure.Bytes32(args.bidId)
	
	this.tokenAddr = ensure.Address(args.tokenAddr)
	this.tokenAmount = ensure.Uint256(args.tokenAmount)
	
	this.validUntil = ensure.Uint256(args.validUntil)

	this.advertiser = ensure.Address(args.advertiser)
	this.publisher = ensure.Address(args.publisher)

	this.validators = Array.isArray(args.validators) ? args.validators.map(ensure.Address) : []
	this.validatorRewards = Array.isArray(args.validatorRewards) ? args.validatorRewards.map(ensure.Uint256) : []
	
	Object.freeze(this.validators)
	Object.freeze(this.validatorRewards)
	Object.freeze(this)

	return this
}

Commitment.prototype.values = function() {
	return [this.bidId, this.tokenAddr, this.tokenAmount, this.validUntil, this.advertiser, this.publisher]
}

Commitment.prototype.hash = function() {
	return keccak256(abi.rawEncode(
		['bytes32', 'bytes32', 'address', 'uint256', 'address', 'address', 'address[]', 'uint256[]'],
		[SCHEMA_HASH, this.bidId, this.tokenAddr, this.tokenAmount, this.advertiser, this.publisher, this.validators, this.validatorRewards]
	))
}

module.exports = { Commitment, SCHEMA_HASH }
