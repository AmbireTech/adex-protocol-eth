const solc = require('solc')
const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const assert = require('assert')

// opts:
// * privSlot, registrySlot: the storage slots used by the proxiedAddr
// * unsafeERC20: true OR safeERC20Artifact
function getProxyDeployTx(
	proxiedAddr,
	feeTokenAddr, feeBeneficiery, feeAmnt,
	registryAddr,
	privLevels,
	opts
) {
	assert.ok(opts, 'opts not passed')
	const { privSlot, registrySlot } = opts
	assert.ok(typeof(privSlot) === 'number', 'privSlot is a number')
	assert.ok(typeof(registrySlot) === 'number', 'registrySlot is a number')

	const privLevelsCode = privLevels
		.map(([addr, level]) => {
			// https://blog.zeppelin.solutions/ethereum-in-depth-part-2-6339cf6bddb9
			const buf = abi.rawEncode(['address', 'uint256'], [addr, privSlot])
			const slot = keccak256(buf)
			return `sstore(0x${slot}, ${level})`
		})
		.join('\n')

	let feeCode = ``
	if (feeAmnt > 0) {
		// This is fine if we're only accepting whitelisted tokens
		if (opts.unsafeERC20) {
			erc20Header = `interface GeneralERC20 { function transfer(address to, uint256 value) external; }`
			feeCode = `GeneralERC20(${feeTokenAddr}).transfer(${feeBeneficiery}, ${feeAmnt});`
		} else {
			erc20Header = opts.safeERC20Artifact.source
				.split('\n')
				.filter(x => !x.startsWith('pragma '))
				.join('\n')
			feeCode = `SafeERC20.transfer(${feeTokenAddr}, ${feeBeneficiery}, ${feeAmnt});`
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
			sstore(${registrySlot}, ${registryAddr})
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
	const input = {
		language: 'Solidity',
		sources: { 'Proxy.sol': { content } },
		settings: {
			outputSelection: {
				'*': {
					'*': [ 'evm.bytecode' ]
				}
			},
			optimizer: {
				enabled: true,
				runs: 200,
			}
		}
	}
	const output = JSON.parse(solc.compile(JSON.stringify(input)))
	assert.ifError(output.errors)
	const byteCode = '0x'+output.contracts['Proxy.sol']['IdentityProxy'].evm.bytecode.object
	return { data: byteCode }
}

function getStorageSlotsFromArtifact(IdentityArtifact) {
	// Find storage locations of privileges, registryAddr
	const identityNode = IdentityArtifact.ast.nodes
		.find(({ name, nodeType }) => nodeType === 'ContractDefinition' && name === 'Identity')
	assert.ok(identityNode, 'Identity contract definition not found')
	const storageVariableNodes = identityNode.nodes
		.filter(n => n.nodeType === 'VariableDeclaration' && !n.constant && n.stateVariable)
	const privSlot = storageVariableNodes.findIndex(x => x.name === 'privileges')
	const registrySlot = storageVariableNodes.findIndex(x => x.name === 'registryAddr')
	assert.notEqual(privSlot, -1, 'privSlot was not found')
	assert.notEqual(registrySlot, -1, 'registrySlot was not found')
	return { privSlot, registrySlot }
}

module.exports = { getProxyDeployTx, getStorageSlotsFromArtifact }
