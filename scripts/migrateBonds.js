const ethers = require('ethers')

const { Contract, getDefaultProvider } = ethers
const { keccak256, defaultAbiCoder, id, bigNumberify, hexlify, Interface } = ethers.utils

const provider = getDefaultProvider('homestead')

const POOL_ID = id('validator:0x2892f6C41E0718eeeDd49D98D648C789668cA67d') // '0x2ce0c96383fb229d9776f33846e983a956a7d95844fac57b180ed0071d93bb28'
const NEW_TOKEN_MUL = bigNumberify('100000000000000')
const ADDR_STAKING = '0x46ad2d37ceaee1e82b70b867e674b903a4b4ca32'
// @TODO
const NEW_ADDR_STAKING = '0x46ad2d37ceaee1e82b70b867e674b903a4b4ca32'

const stakingAbi = require('../abi/Stakingv4.1')

const Staking = new Contract(ADDR_STAKING, stakingAbi, provider)

function getBondId({ owner, amount, poolId, nonce }) {
	return keccak256(
		defaultAbiCoder.encode(
			['address', 'address', 'uint', 'bytes32', 'uint'],
			[ADDR_STAKING, owner, amount, poolId, nonce]
		)
	)
}

function translateOwnerAddr(addr) {
	// @TODO: apply identnties
	return addr
}

async function getMigratedBonds() {
	const logs = await provider.getLogs({ fromBlock: 0, address: ADDR_STAKING })
	//event LogBond(address indexed owner, uint amount, bytes32 poolId, uint nonce, uint64 slashedAtStart);
	//event LogUnbondRequested(address indexed owner, bytes32 indexed bondId, uint64 willUnlock);
	//event LogUnbonded(address indexed owner, bytes32 indexed bondId);
	const migratedLogsSnippets = []
	const migratedBonds = {}
	const bondMapping = {}
	for (const log of logs) {
		const topic = log.topics[0]
		const evs = Staking.interface.events
		if (topic === evs.LogBond.topic) {
			const vals = Staking.interface.parseLog(log).values
			// NOTE there's also slashedAtStart, but we do not need it cause slashing doesn't matter (whole pool gets slashed, ratios stay the same)
			const { owner, amount, poolId, nonce, slashedAtStart } = vals
			const newAmount = amount.mul(NEW_TOKEN_MUL)
			migratedLogsSnippets.push(`emit LogBond(${owner}, ${newAmount.toString(10)}, ${poolId}, ${nonce.toString(10)}, ${slashedAtStart.toString(10)});`)
			// @TODO new contract addr
			const newId = getBondId({ owner, amount: newAmount, poolId, nonce })
			bondMapping[getBondId({owner, amount, poolId, nonce })] = newId
			migratedBonds[newId] = { active: true, slashedAtStart, willUnlock: bigNumberify(0) }
		} else if (topic === evs.LogUnbondRequested.topic) {
			const { owner, bondId, willUnlock } = Staking.interface.parseLog(log).values
			const newId = bondMapping[bondId]
			migratedLogsSnippets.push(`emit LogUnbondRequested(${owner}, ${newId}, ${willUnlock.toString(10)});`)
			migratedBonds[newId].willUnlock = willUnlock
		} else if (topic === evs.LogUnbonded.topic) {
			const { owner, bondId } = Staking.interface.parseLog(log).values
			const newId = bondMapping[bondId]
			migratedLogsSnippets.push(`emit LogUnbonded(${owner}, ${newId});`)
			delete migratedBonds[newId]
		}
	}

	const migratedBondsSnippets = Object.entries(migratedBonds).map(
		([newId, bond]) => `bonds[${newId}] = BondState({ active: true, slashedAtStart: ${bond.slashedAtStart.toString(10)}, willUnlock: ${bond.willUnlock.toString(10)} });`
	)

	return migratedLogsSnippets.concat(migratedBondsSnippets).join('\n')
}

getMigratedBonds().then(x => console.log(x))
