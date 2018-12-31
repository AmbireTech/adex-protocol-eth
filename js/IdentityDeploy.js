const { ContractFactory, utils } = require('ethers')
const keccak256 = require('js-sha3').keccak256

function getIdentityDeployData(seed, deployTx) {
	// @TODO Is it OK to assume 0 for v, should we look into: https://bitcoin.stackexchange.com/questions/38351/ecdsa-v-r-s-what-is-v and https://github.com/ethereum/EIPs/issues/155 and https://blog.sigmaprime.io/solidity-security.html#one-time-addresses
	// https://github.com/ensdomains/CurveArithmetics/blob/master/test/data/secp256k1.js
	const GxLiteral = '0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'
	// starting with 0 guarantees we fit in lowSmax
	const s = '0x0'+new Buffer(keccak256.arrayBuffer(seed)).toString('hex').slice(1)
	const sig = {
		r: GxLiteral,
		s: s,
		recoveryParam: 0,
		v: 27,
	}
	const txRaw = utils.serializeTransaction({
		gasPrice: 1*10**9,
		// usually takes about 2.4m; so this leaves ~400k if the deploy fee token is expensive
		gasLimit: 2800*1000,
		...deployTx,
	}, sig)
	const tx = utils.parseTransaction(txRaw)
	return {
		txRaw,
		tx,
		idContractAddr: getContractAddrWithZeroNonce(tx.from),
	}
}

function getContractAddrWithZeroNonce(deployAddr) {
	// Calculate the id.address in advance
	// really, we need to concat 0xd694{address}00
	// same as require('rlp').encode([relayerAddr, 0x00]) or ethers.utils.RPL.encode([relayerAddr, ... (dunno what)])
	// @TODO: move this out into js/Identity
	const rlpEncodedInput = Buffer.concat([
		// rpl encoding values
		new Uint8Array([0xd6, 0x94]),
		// sender
		Buffer.from(deployAddr.slice(2), 'hex'),
		// nonce (0x80 is equivalent to nonce 0)
		new Uint8Array([0x80]),
	])
	const digest = new Buffer(keccak256.arrayBuffer(rlpEncodedInput))
	return utils.getAddress('0x'+digest.slice(-20).toString('hex'))
}

module.exports = { getIdentityDeployData }
