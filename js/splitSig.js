function splitSig(sig) {
	if (sig.startsWith('0x')) sig = sig.slice(2)
	const r = '0x' + sig.substring(0, 64)
	const s = '0x' + sig.substring(64, 128)
	let v = parseInt(sig.substring(128, 130), 16)
	if (v < 27) v += 27
	// 02 mode is GETH
	const pack = '0x'+'02'+v.toString(16)+'000000000000000000000000000000000000000000000000000000000000'
	return [pack, r, s]
}

module.exports = splitSig
