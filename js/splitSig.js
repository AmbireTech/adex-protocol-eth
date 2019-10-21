function splitSig(inputSig) {
	const sig = inputSig.startsWith('0x') ? inputSig.slice(2) : inputSig
	const r = `0x${sig.substring(0, 64)}`
	const s = `0x${sig.substring(64, 128)}`
	let v = parseInt(sig.substring(128, 130), 16)
	if (v < 27) v += 27
	// 02 mode is GETH
	const pack = `${'0x02'}${v.toString(
		16
	)}000000000000000000000000000000000000000000000000000000000000`
	return [pack, r, s]
}

module.exports = splitSig
