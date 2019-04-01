const solc = require('solc')
const fs = require('fs')

function getProxyDeployTx(proxiedAddr, tokenAddr, relayerAddr, feeAmnt, registryAddr, privLevels) {
	const safeERC20 = fs.readFileSync('./contracts/libs/SafeERC20.sol').toString()
	const privLevelsCode = privLevels
		.map(([addr, level]) => `privileges[address(${addr})] = ${level};`)
		.join('\n')
	const content = `
pragma solidity ^0.5.6;

import "SafeERC20.sol";

contract IdentityProxy {
	// Storage: shared with Identity.sol
	// @TODO autogen this
	mapping (address => uint8) public privileges;
	address public registryAddr;
	uint public nonce = 0;
	mapping (bytes32 => bool) public routinePaidFees;

	constructor()
		public
	{
		${privLevelsCode}
		registryAddr = address(${registryAddr});
		// token, beneficiery, amount
		SafeERC20.transfer(address(${tokenAddr}), address(${relayerAddr}), uint256(${feeAmnt}));
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
