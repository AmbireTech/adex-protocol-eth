const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256

function evmPush(data) {
	if (data.length < 1) throw new Error('evmPush: no data')
	if (data.length > 32) throw new Error('evmPush: data too long')
	const opCode = data.length + 95
	const opCodeBuf = Buffer.alloc(1)
	opCodeBuf.writeUInt8(opCode, 0)
	return Buffer.concat([opCodeBuf, data])
}

function sstoreCode(slotNumber, keyType, key, valueType, value) {
	const buf = abi.rawEncode([keyType, valueType], [key, slotNumber])
	const slot = keccak256(buf)
}

module.exports = { evmPush }

