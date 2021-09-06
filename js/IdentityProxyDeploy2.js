// @TODO: use ethers v5
// @TODO test: if something matches a particular bytecode
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

function sstoreCode(slotNumber, keyType, key, valueType, valueBuf) {
	const buf = abi.rawEncode([keyType, valueType], [key, slotNumber])
	const slot = keccak256(buf)
	return Buffer.concat([
		evmPush(valueBuf),
		evmPush(Buffer.from(slot, 'hex')),
		Buffer.from('55', 'hex')
	])
}

function getProxyDeployBytecode(masterContractAddr, privLevels, opts = { privSlot: 0 }) {
	const { privSlot = 0 } = opts
	const storage = Buffer.concat(privLevels
		.map(([addr, data]) => {
			return data ?
				sstoreCode(privSlot, 'address', addr, 'bytes32', data)
				: sstoreCode(privSlot, 'address', addr, 'bool', Buffer.from('01', 'hex'))
		})
	)
	const initial = Buffer.from('3d602d80', 'hex')
	const offset = storage.length + initial.length + 6 // 6 more bytes including the push added later on
	const initialCode = Buffer.concat([
		storage,
		initial,
		evmPush(Buffer.from([offset]))
	])
	return `0x${initialCode.toString('hex')}3d3981f3363d3d373d3d3d363d73${masterContractAddr.slice(2)}5af43d82803e903d91602b57fd5bf3`
}

module.exports = { evmPush, sstoreCode, getProxyDeployBytecode }

