const { getAddress } = require('ethers').utils
const { BN } = require('bn.js')
const { getBalanceLeaf } = require('./Channel').Channel
const MerkleTree = require('./MerkleTree')

class BalanceTree {
	constructor(tree) {
		const entries = Object.entries(tree).map(([addr, bal]) => [getAddress(addr), new BN(bal, 10)])
		this.balances = Object.fromEntries(entries)
		this.mTree = new MerkleTree(entries.map(([addr, bal]) => getBalanceLeaf(addr, bal)))
		Object.freeze(this)
	}
	getProof(addr) {
		return this.mTree.proof(getBalanceLeaf(addr, this.getBalance(addr)))
	}
	getBalance(addr) {
		return this.balances[getAddress(addr)] || new BN(0)
	}
}

module.exports = BalanceTree
