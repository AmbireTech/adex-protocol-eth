const channelLib = require('./Channel')
module.exports = {
	...channelLib,
	MerkleTree: require('./MerkleTree'),
	splitSig: require('./splitSig'),
}
