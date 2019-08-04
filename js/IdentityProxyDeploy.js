const swarmhash = require('swarmhash')
const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const assert = require('assert')

function Generator() {
	this.jumpdest = new Map();
	this.tpl = '';
	return this
}

Generator.prototype.append = function (code) {
	this.tpl += code;
	return this;
}

Generator.prototype.appendDest = function (tag, code) {
	this.jumpdest.set(tag, this.tpl);
	this.tpl += code;
	return this;
}

Generator.prototype.addSstore = function (slotNumber, keyType, key, value) {
	// https://blog.zeppelin.solutions/ethereum-in-depth-part-2-6339cf6bddb9
	const buf = abi.rawEncode([keyType, 'uint256'], [key, slotNumber])
	const slot = keccak256(buf)
	this.append(`${Generator.pushx(value)}${Generator.pushx(slot)}55`);
	return `sstore(0x${slot}, ${value})`
}

Generator.prototype.assemble = function (dataSize, subTagSize) {
	let bytecode = this.tpl;
	let tagSize = this.tagSize(dataSize, subTagSize);
	this.jumpdest.forEach((dest, tag) => {
		const pos = tagSize === 1 ? dest.length / 2 : dest.replace(new RegExp('t', 'g'), 'tag').length / 2;
		bytecode = bytecode.replace(new RegExp(tag, 'g'), Generator.pushx(pos, tagSize));
	});
	return bytecode;
}

Generator.prototype.pos = function (tag) {
	const tagSize = this.tagSize();
	const dest = this.jumpdest.get(tag);
	if (dest) {
		return tagSize === 1 ? dest.length / 2 : dest.replace(new RegExp('t', 'g'), 'tag').length / 2;
	}
	return -1;
}

Generator.prototype.tagSize = function (dataSize, subTagSize) {
	if (!dataSize) dataSize = 0;
	let tagSize = (this.tpl.length + dataSize) / 2 > 255 ? 2 : 1;
	if (subTagSize && subTagSize > tagSize) tagSize = subTagSize;
	return tagSize;
}

Generator.genMetadataHashBytecode = function (content) {
	const srcKeccakHash = keccak256(content);
	const srcSwarmHash = swarmhash(Buffer.from(content)).toString('hex');
	const metadata = `{"compiler":{"version":"0.5.6+commit.b259423e"},"language":"Solidity","output":{"abi":[{"inputs":[],"payable":false,"stateMutability":"nonpayable","type":"constructor"},{"payable":false,"stateMutability":"nonpayable","type":"fallback"}],"devdoc":{"methods":{}},"userdoc":{"methods":{}}},"settings":{"compilationTarget":{"browser/IdentityProxy.sol":"IdentityProxy"},"evmVersion":"petersburg","libraries":{},"optimizer":{"enabled":true,"runs":200},"remappings":[]},"sources":{"browser/IdentityProxy.sol":{"keccak256":"0x${srcKeccakHash}","urls":["bzzr://${srcSwarmHash}"]}},"version":1}`;
	const metadataHash = swarmhash(Buffer.from(metadata)).toString('hex');
	// https://solidity.readthedocs.io/en/v0.5.6/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode
	// 0xa1 0x65 'b' 'z' 'z' 'r' '0' 0x58 0x20 <32 bytes swarm hash> 0x00 0x29
	const metadataHashBytecode = `a165627a7a72305820${metadataHash}0029`;
	return metadataHashBytecode;
}

Generator.pushx = function (value, minlen) {
	let rs;
	if (typeof value === 'number') {
		rs = value.toString(16);
	} else {
		rs = value.toLowerCase();
		if (rs.startsWith('0x')) {
			rs = rs.substr(2);
		}
		assert.ok(/^[0-9a-f]+$/.test(rs), 'invalid hex')
	}
	rs = rs.length % 2 === 0 ? rs : `0${rs}`;
	if (minlen > 0 && rs.length < minlen * 2) {
		rs = '0'.repeat(minlen * 2 - rs.length) + rs;
	}
	assert.ok(rs.length <= 64, 'invalid hex length')
	return (95 + rs.length / 2).toString(16) + rs;
}

// opts:
// * privSlot: the storage slots used by the proxiedAddr
// * unsafeERC20: true OR safeERC20Artifact
function getProxyDeployBytecode(proxiedAddr, privLevels, opts) {
	assert.ok(opts, 'opts not passed')
	const { privSlot, routineAuthsSlot } = opts
	assert.ok(typeof privSlot === 'number', 'privSlot must be a number')

	var initGen = new Generator();
	initGen.append('6080604052348015t01>57600080fd');
	initGen.appendDest('t01>', '5b50');

	const privLevelsCode = privLevels
		.map(([addr, level]) => initGen.addSstore(privSlot, 'address', addr, level))
		.join('\n')

	let routineAuthsCode = ''
	if (opts.routineAuthorizations) {
		assert.ok(typeof routineAuthsSlot === 'number', 'routineAuthsSlot must be a number')
		routineAuthsCode = opts.routineAuthorizations
			.map(hash => initGen.addSstore(routineAuthsSlot, 'bytes32', hash, '0x01'))
			.join('\n')
	}

	var fnGen = new Generator();
	fnGen.append('6080604052348015t02>57600080fd');
	fnGen.appendDest('t02>', `5b50${Generator.pushx(proxiedAddr)}3660008037600080366000846127105a03f43d6000803e808015t06>573d6000f3`);
	fnGen.appendDest('t06>', '5b3d6000fd');

	let erc20Header = ''
	let feeCode = ''
	if (opts.fee) {
		const fee = opts.fee
		// This is fine if we're only accepting whitelisted tokens
		if (fee.unsafeERC20) {
			erc20Header = `interface GeneralERC20 { function transfer(address to, uint256 value) external; }`
			feeCode = `GeneralERC20(${fee.tokenAddr}).transfer(${fee.recepient}, ${fee.amount});`

			initGen.append(`604080517fa9059cbb000000000000000000000000000000000000000000000000000000008152${Generator.pushx(fee.recepient)}6004820152${Generator.pushx(fee.amount)}60248201529051${Generator.pushx(fee.tokenAddr)}9163a9059cbb91604480830192600092919082900301818387803b158015t04>57600080fd`);
			initGen.appendDest('t04>', '5b505af1158015t05>573d6000803e3d6000fd');
			initGen.appendDest('t05>', '5b50505050');
		} else {
			assert.ok(fee.safeERC20Artifact, 'opts: either unsafeERC20 or safeERC20Artifact required')
			erc20Header = fee.safeERC20Artifact.source
				.split('\n')
				.filter(x => !x.startsWith('pragma '))
				.join('\n')
			feeCode = `SafeERC20.transfer(${fee.tokenAddr}, ${fee.recepient}, ${fee.amount});`

			fnGen.appendDest('t07>', '5b826001600160a01b031663a9059cbb83836040518363ffffffff1660e01b815260040180836001600160a01b03166001600160a01b0316815260200182815260200192505050600060405180830381600087803b158015t09>57600080fd');
			fnGen.appendDest('t09>', '5b505af1158015t10>573d6000803e3d6000fd');
			fnGen.appendDest('t10>', '5b50505050t11>t12>56');
			fnGen.appendDest('t11>', '5bt13>57600080fd');
			fnGen.appendDest('t13>', '5b50505056');
			fnGen.appendDest('t12>', '5b6000803d8015t16>5760208114t17>57t15>56');
			fnGen.appendDest('t16>', '5b60019150t15>56');
			fnGen.appendDest('t17>', '5b60206000803e6000519150');
			fnGen.appendDest('t15>', '5b50151590509056');

			initGen.append(`t04>${Generator.pushx(fee.tokenAddr)}${Generator.pushx(fee.recepient)}${Generator.pushx(fee.amount)}t05>60201b${Generator.pushx(fnGen.pos('t07>'), 2)}1760201c56`);
			initGen.appendDest('t04>', '5bt06>56');
			initGen.appendDest('t05>', '5b826001600160a01b031663a9059cbb83836040518363ffffffff1660e01b815260040180836001600160a01b03166001600160a01b0316815260200182815260200192505050600060405180830381600087803b158015t08>57600080fd');
			initGen.appendDest('t08>', '5b505af1158015t09>573d6000803e3d6000fd');
			initGen.appendDest('t09>', '5b50505050t10>t11>60201b60201c56');
			initGen.appendDest('t10>', '5bt12>57600080fd');
			initGen.appendDest('t12>', '5b50505056');
			initGen.appendDest('t11>', '5b6000803d8015t15>5760208114t16>57t14>56');
			initGen.appendDest('t15>', '5b60019150t14>56');
			initGen.appendDest('t16>', '5b60206000803e6000519150');
			initGen.appendDest('t14>', '5b50151590509056');
			initGen.appendDest('t06>', '5b');
		}
	}

	const content = `
pragma solidity ^0.5.6;
${erc20Header}
contract IdentityProxy {
	constructor()
		public
	{
		assembly {
			${privLevelsCode}
			${routineAuthsCode}
		}
		${feeCode}
	}

	function () external
	{
		address to = address(${proxiedAddr});
		assembly {
			calldatacopy(0, 0, calldatasize())
			let result := delegatecall(sub(gas, 10000), to, 0, calldatasize(), 0, 0)
			returndatacopy(0, 0, returndatasize)
			switch result case 0 {revert(0, returndatasize)} default {return (0, returndatasize)}
		}
	}
}`

	const fnCode = fnGen.assemble() + 'fe' + Generator.genMetadataHashBytecode(content);
	let bytecode = initGen.assemble(fnCode.length / 2, fnGen.tagSize());

	// CODECOPY
	bytecode += `${Generator.pushx(fnCode.length / 2)}80`;
	bytecode += `${Generator.pushx(bytecode.length / 2 + 10, 2)}6000396000f3`;
	bytecode += 'fe' + fnCode;
	return `0x${bytecode}`
}

/*
function getProxyDeploy(proxiedAddr, privLevels, opts) {
	const bytecode = getProxyDeployBytecode(proxiedAddr, privLevels, opts)
	return { bytecode, address, salt }
}
*/

function getStorageSlotsFromArtifact(IdentityArtifact) {
	// Find storage locations of privileges
	const identityNode = IdentityArtifact.ast.nodes.find(
		({ name, nodeType }) => nodeType === 'ContractDefinition' && name === 'Identity'
	)
	assert.ok(identityNode, 'Identity contract definition not found')
	const storageVariableNodes = identityNode.nodes.filter(
		n => n.nodeType === 'VariableDeclaration' && !n.constant && n.stateVariable
	)
	const privSlot = storageVariableNodes.findIndex(x => x.name === 'privileges')
	assert.notEqual(privSlot, -1, 'privSlot was not found')
	const routineAuthsSlot = storageVariableNodes.findIndex(x => x.name === 'routineAuthorizations')
	assert.notEqual(routineAuthsSlot, -1, 'routineAuthsSlot was not found')
	return { privSlot, routineAuthsSlot }
}

module.exports = { getProxyDeployBytecode, getStorageSlotsFromArtifact }
