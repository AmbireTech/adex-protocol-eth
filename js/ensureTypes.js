const { BN } = require('bn.js')

function Uint256(x) {
	const bn = new BN(x, 10)
	if (bn.isNeg()) throw 'uint256 expected, negative number given'
	return bn
}
function Address(x) {
	if (!(typeof(x) === 'string' && x.length === 42 && x.startsWith('0x')))
		throw 'invalid address: must start with a 0x and be 42 characters long'
	return x
}
function Bytes32(b) {
	if (!(b.length === 32 && Buffer.isBuffer(b))) throw '32 byte Buffer expected'
	return b
}

module.exports = { Uint256, Bytes32, Address }
