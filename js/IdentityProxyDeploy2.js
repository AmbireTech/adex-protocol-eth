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
	if (privLevels.length > 3) throw new Error('getProxyDeployBytecode: max 3 privLevels')
	const storage = Buffer.concat(privLevels
		.map(([addr, data]) => {
			return data ?
				sstoreCode(privSlot, 'address', addr, 'bytes32', data)
				: sstoreCode(privSlot, 'address', addr, 'bool', Buffer.from('01', 'hex'))
		})
	)
	const initial = Buffer.from('3d602d80', 'hex')
	// NOTE: this means we can't support offset>256
	// @TODO solve this case; this will remove the "max 3 privLevels" restriction
	const offset = storage.length + initial.length + 6 // 6 more bytes including the push added later on
	if (offset > 256) throw new Error('getProxyDeployBytecode: internal: offset>256')
	const initialCode = Buffer.concat([
		storage,
		initial,
		evmPush(Buffer.from([offset]))
	])
	return `0x${initialCode.toString('hex')}3d3981f3363d3d373d3d3d363d73${masterContractAddr.slice(2)}5af43d82803e903d91602b57fd5bf3`
}

// test
// assert.eq(getProxyDeployBytecode('0x02a63ec1bced5545296a5193e652e25ec0bae410', [['0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA', null]]), '0x60017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80602e3d3981f3363d3d373d3d3d363d7302a63ec1bced5545296a5193e652e25ec0bae4105af43d82803e903d91602b57fd5bf3')

module.exports = { evmPush, sstoreCode, getProxyDeployBytecode }

