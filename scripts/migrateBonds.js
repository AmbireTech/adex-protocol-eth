const ethers = require('ethers')
const assert = require('assert')
const { Contract, getDefaultProvider } = ethers
const { keccak256, defaultAbiCoder, id, bigNumberify, hexlify, Interface, getContractAddress } = ethers.utils

const provider = getDefaultProvider('homestead')

const POOL_ID = id('validator:0x2892f6C41E0718eeeDd49D98D648C789668cA67d') // '0x2ce0c96383fb229d9776f33846e983a956a7d95844fac57b180ed0071d93bb28'
const NEW_TOKEN_MUL = bigNumberify('100000000000000')
const ADDR_STAKING = '0x46Ad2D37CeaeE1e82B70B867e674b903a4b4Ca32'
const NEW_ADDR_STAKING = getContractAddress({ from: '0x1304f1b9e8eb2c328b564e7fad2c8402a5954572', nonce: 18 })

assert.equal(ADDR_STAKING, getContractAddress({ from: '0x1304f1b9e8eb2c328b564e7fad2c8402a5954572', nonce: 12 }))

const stakingAbi = require('../abi/Stakingv4.1')

const Staking = new Contract(ADDR_STAKING, stakingAbi, provider)

function getBondId(contractAddr, { owner, amount, poolId, nonce }) {
	return keccak256(
		defaultAbiCoder.encode(
			['address', 'address', 'uint', 'bytes32', 'uint'],
			[contractAddr, owner, amount, poolId, nonce]
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
	const toUnbond = {}
	const toBond = {}
	const bonds = {}

	for (const log of logs) {
		const topic = log.topics[0]
		const evs = Staking.interface.events
		if (topic === evs.LogBond.topic) {
			const vals = Staking.interface.parseLog(log).values
			const { owner, amount, poolId, nonce, slashedAtStart } = vals
			assert.ok(slashedAtStart.eq(0), 'this script only works for 0 slash pools')
			if (poolId !== POOL_ID) continue
			bonds[getBondId(ADDR_STAKING, {owner, amount, poolId, nonce })] = { owner, amount }
		} else if (topic === evs.LogUnbondRequested.topic) {
			const { owner, bondId, willUnlock } = Staking.interface.parseLog(log).values
			bonds[bondId].willUnlock = willUnlock
		} else if (topic === evs.LogUnbonded.topic) {
			const { owner, bondId } = Staking.interface.parseLog(log).values
			delete bonds[bondId]
		}
	}

	Object.values(bonds).forEach(bond => {
		if (bond.willUnlock) {
			toUnbond[bond.owner] = (toUnbond[bond.owner] || bigNumberify(0)).add(bond.amount)
		} else {
			const addr = translateOwnerAddr(bond.owner)
			const amount = bond.amount.mul(NEW_TOKEN_MUL)
			toBond[addr] = (toBond[addr] || bigNumberify(0)).add(amount)
		}
	})

	//console.log(toUnbond)
	//console.log(Object.values(toUnbond).reduce((a, b) => a.add(b)))

	// @TODO consider 0 nonce
	const nonce = Math.floor(Date.now() / 1000)
	const migratedLogsSnippets = Object.entries(toBond).map(([owner, amount]) => `emit LogBond(${owner}, ${amount.toString(10)}, ${POOL_ID}, ${nonce.toString(10)}, 0);`)
	const migratedBondsSnippets = Object.entries(toBond).map(
		([owner, amount]) => `bonds[${getBondId(NEW_ADDR_STAKING, { owner, amount, poolId: POOL_ID, nonce })}] = BondState({ active: true, slashedAtStart: 0, willUnlock: 0 });`
	)

	return [
		`// Total migrated ADX: ${Object.values(toBond).reduce((a, b) => a.add(b)).toString(10)}`,
		`// New staking addr: ${NEW_ADDR_STAKING}`
	].concat(migratedLogsSnippets).concat(migratedBondsSnippets).join('\n')
}

getMigratedBonds().then(x => console.log(x))
