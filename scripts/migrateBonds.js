/* eslint-disable no-restricted-syntax */
/* eslint-disable no-continue */
/* eslint-disable no-console */
const ethers = require('ethers')
const assert = require('assert')

const { Contract, getDefaultProvider } = ethers
const {
	keccak256,
	defaultAbiCoder,
	id,
	bigNumberify,
	getContractAddress,
	getAddress
} = ethers.utils
const { generateAddress2 } = require('ethereumjs-util')

const provider = getDefaultProvider('homestead')

const POOL_ID = id('validator:0x2892f6C41E0718eeeDd49D98D648C789668cA67d') // '0x2ce0c96383fb229d9776f33846e983a956a7d95844fac57b180ed0071d93bb28'
const NEW_TOKEN_MUL = bigNumberify('100000000000000')
const ADDR_STAKING = '0x46Ad2D37CeaeE1e82B70B867e674b903a4b4Ca32'
const NEW_ADDR_STAKING = getContractAddress({
	from: '0x1304f1b9e8eb2c328b564e7fad2c8402a5954572',
	nonce: 19
})
const IDENTITY_FACTORY = '0x9fe0d438e3c29c7cff949ad8e8da9403a531cc1a'

assert.equal(
	ADDR_STAKING,
	getContractAddress({ from: '0x1304f1b9e8eb2c328b564e7fad2c8402a5954572', nonce: 12 })
)

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

function getStakingIdentityBytecode(addr) {
	return `0x608060405234801561001057600080fd5b5060026000803073ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060006101000a81548160ff021916908360ff160217905550600260008073${addr
		.slice(2)
		.toLowerCase()}73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060006101000a81548160ff021916908360ff1602179055506000734470bb87d77b963a013db939be332f927f2b992e9050600073ade00c28244d5ce17d72e40330b1c318cd12b7c3905060008273ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff1660e01b81526004016101429190610501565b60206040518083038186803b15801561015a57600080fd5b505afa15801561016e573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610192919061045a565b90506000811115610276578273ffffffffffffffffffffffffffffffffffffffff1663095ea7b383836040518363ffffffff1660e01b81526004016101d892919061051c565b600060405180830381600087803b1580156101f257600080fd5b505af1158015610206573d6000803e3d6000fd5b505050508173ffffffffffffffffffffffffffffffffffffffff166394b918de826040518263ffffffff1660e01b81526004016102439190610560565b600060405180830381600087803b15801561025d57600080fd5b505af1158015610271573d6000803e3d6000fd5b505050505b60008273ffffffffffffffffffffffffffffffffffffffff166370a08231306040518263ffffffff1660e01b81526004016102b19190610501565b60206040518083038186803b1580156102c957600080fd5b505afa1580156102dd573d6000803e3d6000fd5b505050506040513d601f19601f82011682018060405250810190610301919061045a565b9050600081111561043c576000734846c6837ec670bbd1f5b485471c8f64ecb9c53490508373ffffffffffffffffffffffffffffffffffffffff1663095ea7b382846040518363ffffffff1660e01b815260040161036092919061051c565b600060405180830381600087803b15801561037a57600080fd5b505af115801561038e573d6000803e3d6000fd5b505050508073ffffffffffffffffffffffffffffffffffffffff1663b4dca72460405180606001604052808581526020017f2ce0c96383fb229d9776f33846e983a956a7d95844fac57b180ed0071d93bb2860001b8152602001428152506040518263ffffffff1660e01b81526004016104089190610545565b600060405180830381600087803b15801561042257600080fd5b505af1158015610436573d6000803e3d6000fd5b50505050505b505050506105d8565b600081519050610454816105c1565b92915050565b60006020828403121561046c57600080fd5b600061047a84828501610445565b91505092915050565b61048c8161057b565b82525050565b61049b8161058d565b82525050565b6060820160008201516104b760008501826104e3565b5060208201516104ca6020850182610492565b5060408201516104dd60408501826104e3565b50505050565b6104ec816105b7565b82525050565b6104fb816105b7565b82525050565b60006020820190506105166000830184610483565b92915050565b60006040820190506105316000830185610483565b61053e60208301846104f2565b9392505050565b600060608201905061055a60008301846104a1565b92915050565b600060208201905061057560008301846104f2565b92915050565b600061058682610597565b9050919050565b6000819050919050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b6000819050919050565b6105ca816105b7565b81146105d557600080fd5b50565b6101b7806105e76000396000f3fe608060405234801561001057600080fd5b506004361061002f5760003560e01c8063c066a5b11461007357610030565b5b60007396e3cb4b4632ed45363ff2c9f0fbec9b583d9d3a90503660008037600080366000846127105a03f43d6000803e806000811461006e573d6000f35b3d6000fd5b61008d600480360381019061008891906100d8565b6100a3565b60405161009a9190610110565b60405180910390f35b60006020528060005260406000206000915054906101000a900460ff1681565b6000813590506100d28161016a565b92915050565b6000602082840312156100ea57600080fd5b60006100f8848285016100c3565b91505092915050565b61010a8161015d565b82525050565b60006020820190506101256000830184610101565b92915050565b60006101368261013d565b9050919050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b600060ff82169050919050565b6101738161012b565b811461017e57600080fd5b5056fea26469706673582212200e40aa3025d54e828fb973089b64ce06688fedcd71b98ae68521a0217652c59564736f6c634300060c0033`
}

function translateOwnerAddr(addr) {
	const bytecode = getStakingIdentityBytecode(addr)
	return getAddress(
		`0x${generateAddress2(IDENTITY_FACTORY, Buffer.alloc(32), bytecode).toString('hex')}`
	)
}

async function getMigratedBonds() {
	const logs = await provider.getLogs({ fromBlock: 0, address: ADDR_STAKING })
	// event LogBond(address indexed owner, uint amount, bytes32 poolId, uint nonce, uint64 slashedAtStart);
	// event LogUnbondRequested(address indexed owner, bytes32 indexed bondId, uint64 willUnlock);
	// event LogUnbonded(address indexed owner, bytes32 indexed bondId);
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
			bonds[getBondId(ADDR_STAKING, { owner, amount, poolId, nonce })] = { owner, amount }
		} else if (topic === evs.LogUnbondRequested.topic) {
			const { bondId, willUnlock } = Staking.interface.parseLog(log).values
			bonds[bondId].willUnlock = willUnlock
		} else if (topic === evs.LogUnbonded.topic) {
			const { bondId } = Staking.interface.parseLog(log).values
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

	// console.log(toUnbond)
	// console.log(Object.values(toUnbond).reduce((a, b) => a.add(b)))

	const nonce = 0
	const time = Math.floor(Date.now() / 1000)
	const migratedLogsSnippets = Object.entries(toBond).map(
		([owner, amount]) =>
			`emit LogBond(${owner}, ${amount.toString(10)}, ${POOL_ID}, ${nonce.toString(
				10
			)}, 0, ${time.toString(10)});`
	)
	const migratedBondsSnippets = Object.entries(toBond).map(
		([owner, amount]) =>
			`bonds[${getBondId(NEW_ADDR_STAKING, {
				owner,
				amount,
				poolId: POOL_ID,
				nonce
			})}] = BondState({ active: true, slashedAtStart: 0, willUnlock: 0 });`
	)

	const toBeReleased = Object.entries(toUnbond)
		.map(
			([addr, amnt]) =>
				`// SafeERC20.transfer(0x4470BB87d77b963A013DB939BE332f927f2b992e, ${addr}, ${amnt.toNumber()});`
		)
		.join('\n')
	return [
		`// Tokens to be released early: ${Object.values(toUnbond)
			.reduce((a, b) => a.add(b))
			.toNumber() / 10000}`,
		`//  more specifically:\n${toBeReleased}`,
		`// Total migrated ADX: ${Object.values(toBond)
			.reduce((a, b) => a.add(b))
			.toString(10)}`,
		`// New staking addr: ${NEW_ADDR_STAKING}`
	]
		.concat(migratedLogsSnippets)
		.concat(migratedBondsSnippets)
		.join('\n')
}

getMigratedBonds().then(x => console.log(x))
