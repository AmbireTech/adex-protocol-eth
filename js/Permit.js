const { keccak256, defaultAbiCoder, toUtf8Bytes, solidityPack } = require('ethers').utils

const PERMIT_TYPEHASH = keccak256(
	toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

function getDomainSeparator(name, tokenAddress, chainId) {
	return keccak256(
		defaultAbiCoder.encode(
			['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
			[
				keccak256(
					toUtf8Bytes(
						'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
					)
				),
				keccak256(toUtf8Bytes(name)),
				keccak256(toUtf8Bytes('1')),
				chainId,
				tokenAddress
			]
		)
	)
}

function getApprovalDigest(token, approve, nonce, deadline) {
	const DOMAIN_SEPARATOR = getDomainSeparator(token.name, token.address, token.chainId)

	return keccak256(
		solidityPack(
			['bytes1', 'bytes1', 'bytes32', 'bytes32'],
			[
				'0x19',
				'0x01',
				DOMAIN_SEPARATOR,
				keccak256(
					defaultAbiCoder.encode(
						['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
						[PERMIT_TYPEHASH, approve.owner, approve.spender, approve.value, nonce, deadline]
					)
				)
			]
		)
	)
}

module.exports = { getDomainSeparator, getApprovalDigest }
