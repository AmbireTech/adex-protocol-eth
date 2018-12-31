const channelLib = require('./Channel')
const identityLib = require('./Identity')
const identityDeployLib = require('./IdentityDeploy')
module.exports = {
	...channelLib,
	...identityLib,
	...identityDeployLib,
	MerkleTree: require('./MerkleTree'),
	splitSig: require('./splitSig'),
}
