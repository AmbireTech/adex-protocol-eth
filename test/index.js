const { Channel } = require('../js')

async function expectEVMError(promise, errString) {
	try {
		await promise
		assert.isOk(false, `should have failed with ${errString}`)
	} catch (e) {
		const expectedString = errString
			? `VM Exception while processing transaction: revert ${errString}`
			: 'VM Exception while processing transaction: revert'
		assert.equal(e.message, expectedString, 'error message is incorrect')
	}
}

function sampleChannel(accounts, tokenAddr, creator, amount, validUntil, nonce) {
	const spec = Buffer.alloc(32)
	spec.writeUInt32BE(nonce)
	return new Channel({
		creator,
		tokenAddr,
		tokenAmount: amount,
		validUntil,
		validators: [accounts[0], accounts[1]],
		spec
	})
}

function handleJsonRPCErr(resolve, reject, err, res) {
	if (err) reject(err)
	else if (res.error) reject(res.error)
	else resolve(res)
}

function moveTime(web3, time) {
	return new Promise(function(resolve, reject) {
		web3.currentProvider.send(
			{
				jsonrpc: '2.0',
				method: 'evm_increaseTime',
				params: [time],
				id: 0
			},
			handleJsonRPCErr.bind(null, resolve, reject)
		)
	})
}

async function setTime(web3, time) {
	// Doesn't work cause of a ganache bug: `e.getTime is not a function` cause it doesn't construct a date from the JSONRPC input
	return new Promise(function(resolve, reject) {
		web3.currentProvider.send(
			{
				jsonrpc: '2.0',
				method: 'evm_setTime',
				params: [new Date(time * 1000)],
				id: 0
			},
			handleJsonRPCErr.bind(null, resolve, reject)
		)
	})
}

module.exports = { expectEVMError, sampleChannel, moveTime, setTime }
