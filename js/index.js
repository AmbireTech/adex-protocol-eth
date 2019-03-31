const channelLib = require('./Channel')
const identityLib = require('./Identity')
module.exports = {
	...channelLib,
	...identityLib,
	MerkleTree: require('./MerkleTree'),
	splitSig: require('./splitSig'),
}
