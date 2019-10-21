// from https://github.com/ConnextProject/connext-client/blob/master/src/helpers/MerkleTree.js
const Buffer = require('buffer').Buffer
const keccak256 = require('js-sha3').keccak256

function combinedHash(first, second) {
	if (!second) {
		return first
	}
	if (!first) {
		return second
	}
	const sorted = Buffer.concat([first, second].sort(Buffer.compare))

	return Buffer.from(keccak256.arrayBuffer(sorted))
}

function deduplicate(buffers) {
	// NOTE: performance?
	return buffers.filter((buffer, i) => {
		return buffers.findIndex(e => e.equals(buffer)) === i
	})
}

function getPair(index, layer) {
	const pairIndex = index % 2 ? index - 1 : index + 1
	if (pairIndex < layer.length) {
		return layer[pairIndex]
	}
	return null
}

function getLayers(elements) {
	if (elements.length === 0) {
		return [[Buffer.from('')]]
	}
	const layers = []
	layers.push(elements)
	while (layers[layers.length - 1].length > 1) {
		layers.push(getNextLayer(layers[layers.length - 1]))
	}
	return layers
}

function getNextLayer(elements) {
	return elements.reduce((layer, element, index, arr) => {
		if (index % 2 === 0) {
			layer.push(combinedHash(element, arr[index + 1]))
		}
		return layer
	}, [])
}

class MerkleTree {
	constructor(_elements) {
		if (!_elements.every(b => b.length === 32 && Buffer.isBuffer(b))) {
			throw new Error('elements must be 32 byte buffers')
		}
		const e = { elements: deduplicate(_elements) }
		Object.assign(this, e)
		this.elements.sort(Buffer.compare)

		const l = { layers: getLayers(this.elements) }
		Object.assign(this, l)
	}

	getRoot() {
		if (!this.root) {
			const r = { root: this.layers[this.layers.length - 1][0] }
			Object.assign(this, r)
		}
		return this.root
	}

	verify(proof, element) {
		return this.getRoot().equals(proof.reduce((hash, pair) => combinedHash(hash, pair), element))
	}

	proof(element) {
		let index = this.elements.findIndex(e => e.equals(element))

		if (index === -1) {
			throw new Error('element not found in merkle tree')
		}

		return this.layers.reduce((proof, layer) => {
			const pair = getPair(index, layer)
			if (pair) {
				proof.push(pair)
			}
			index = Math.floor(index / 2)
			return proof
		}, [])
	}
}
module.exports = MerkleTree
