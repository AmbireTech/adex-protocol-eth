const ethereumAbi = require('ethereumjs-abi')

// https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md
// @TODO: use eth-sig-util in the tests, so we can conform with what metamask does
// https://github.com/MetaMask/eth-sig-util/blob/master/index.js
// https://github.com/ethereumjs/ethereumjs-abi/blob/master/lib/index.js
const SCHEMA_HASH = '0x8aa1fb0e671ad6f7d73ad552eff29b7b79186e0143b91e48a013151a34ae50dd'

const ensure = require('./ensureTypes')

function Commitment(args) {
	this.bidId = ensure.Bytes32(args.bidId)
	
	this.tokenAddr = ensure.Address(args.tokenAddr)
	this.tokenAmount = ensure.Uint256(args.tokenAmount)
	
	this.validUntil = ensure.Uint256(args.validUntil)

	this.advertiser = ensure.Address(this.advertiser)
	this.publisher = ensure.Address(this.publisher)

	this.validators = Array.isArray(args.validators) ? args.validators.map(ensure.Address) : []
	this.validatorRewards = Array.isArray(args.validatorRewards) ? args.validatorRewards.map(ensure.Uint256) : []
	
	Object.freeze(this.validators)
	Object.freeze(this.validatorRewards)
	Object.freeze(this)

	return this
}

// @TODO: decode from ethereum ABI
// @TODO: encode to ethereum ABI

Commitment.prototype.hash = function() {
	// @TODO
}

module.exports = { Commitment, SCHEMA_HASH }
