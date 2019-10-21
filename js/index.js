const channelLib = require('./Channel')
const identityLib = require('./Identity')
const MerkleTree = require('./MerkleTree')
const splitSig = require('./splitSig')

module.exports = {
	...channelLib,
	...identityLib,
	MerkleTree,
	splitSig
}
