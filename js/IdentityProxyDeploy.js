const solc = require('solc')
const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256
const assert = require('assert')

const safeERC20Artifact = require('../build/contracts/SafeERC20')
const IdentityArtifact = require('../build/contracts/Identity')

function getProxyDeployTx(
	proxiedAddr,
	feeTokenAddr, feeBeneficiery, feeAmnt,
	registryAddr,
	privLevels,
	opts = { unsafeERC20: false }
) {
	// @TODO autogen storage slots; or alternatively just assert if they're in their place
	const privSlot = 0
	const registrySlot = 1
	const privLevelsCode = privLevels
		.map(([addr, level]) => {
			// https://blog.zeppelin.solutions/ethereum-in-depth-part-2-6339cf6bddb9
			const buf = abi.rawEncode(['address', 'uint256'], [addr, privSlot])
			const slot = keccak256(buf)
			return `sstore(0x${slot}, ${level})`
		})
		.join('\n')

	const safeERC20Header = safeERC20Artifact.source
		.split('\n')
		.filter(x => !x.startsWith('pragma '))
		.join('\n')

	let feeCode = ``
	if (feeAmnt > 0) {
		// This is fine if we're only accepting whitelisted tokens
		if (opts.unsafeERC20) {
			feeCode = `GeneralERC20(${feeTokenAddr}).transfer(${feeBeneficiery}, ${feeAmnt});`
		} else {
			feeCode = `SafeERC20.transfer(${feeTokenAddr}, ${feeBeneficiery}, ${feeAmnt});`
		}
	}

	const content = `
pragma solidity ^0.5.6;
${safeERC20Header}
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
					'*': [ '*' ]
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

module.exports = { getProxyDeployTx }
