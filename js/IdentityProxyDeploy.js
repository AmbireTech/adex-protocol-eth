const solc = require('solc')
const fs = require('fs')
const abi = require('ethereumjs-abi')
const keccak256 = require('js-sha3').keccak256

function getProxyDeployTx(
	proxiedAddr,
	feeTokenAddr, feeBeneficiery, feeAmnt,
	registryAddr,
	privLevels,
	opts = { unsafeERC20: false }
) {
	const safeERC20 = fs.readFileSync('./contracts/libs/SafeERC20.sol').toString()
	// @TODO autogen storage slots; or alternatively just assert if they're in their place
	const privSlot = 0
	const registrySlot = 1
	const privLevelsCode = privLevels
		.map(([addr, level]) => {
			const buf = abi.rawEncode(['address', 'uint256'], [addr, privSlot])
			const slot = keccak256(buf)
			return `sstore(0x${slot}, ${level})`
		})
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
import "SafeERC20.sol";

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
		sources: {
			'SafeERC20.sol': { content: safeERC20 },
			'Proxy.sol': { content }
		},
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
	const byteCode = '0x'+output.contracts['Proxy.sol']['IdentityProxy'].evm.bytecode.object
	return { data: byteCode }
}

module.exports = { getProxyDeployTx }
