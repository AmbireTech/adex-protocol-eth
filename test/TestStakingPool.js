/** globals afterEach */
const { providers, Contract, ethers } = require('ethers')
const { bigNumberify } = require('ethers').utils
const { expectEVMError, takeSnapshot, revertToSnapshot, moveTime } = require('./')
const { UnbondCommitment } = require('../js')
const { parseADX } = require('./lib')

const StakingPoolArtifact = artifacts.require('StakingPool')
const MockChainlink = artifacts.require('MockChainlink')
const MockUniswap = artifacts.require('MockUniswap')
const MockToken = artifacts.require('Token')
const ADXSupplyController = artifacts.require('ADXSupplyController')
const ADXToken = artifacts.require('ADXToken')

const web3Provider = new providers.Web3Provider(web3.currentProvider)

const DAY_SECONDS = 24 * 60 * 60

contract('StakingPool', function(accounts) {
	let stakingPool
	// let token
	let prevToken
	// eslint-disable-next-line no-unused-vars
	let chainlink
	// eslint-disable-next-line no-unused-vars
	let uniswap
	let adxSupplyController
	let adxToken
	let snapShotId
	const userAcc = accounts[0]
	const guardianAddr = accounts[1]
	const validatorAddr = accounts[2]
	const governanceAddr = accounts[3]
	const anotherUser = accounts[4]
	const governanceSigner = web3Provider.getSigner(governanceAddr)

	async function enterStakingPool(acc, amountToEnter) {
		// const amountToEnter = bigNumberify('1000000')
		// set user balance
		await prevToken.connect(web3Provider.getSigner(acc)).setBalanceTo(acc, amountToEnter)
		await adxToken.connect(web3Provider.getSigner(acc)).swap(amountToEnter)
		// approve Staking pool
		await (await adxToken
			.connect(web3Provider.getSigner(acc))
			.approve(stakingPool.address, parseADX('1000'))).wait()
		await (await stakingPool.connect(web3Provider.getSigner(acc)).enter(parseADX('10'))).wait()
	}

	before(async function() {
		const tokenWeb3 = await MockToken.new()

		// WARNING: all invokations to core/token will be from account[0]
		const signer = web3Provider.getSigner(userAcc)
		prevToken = new Contract(tokenWeb3.address, MockToken._json.abi, signer)

		const adxTokenWeb3 = await ADXToken.new(userAcc, prevToken.address)
		adxToken = new Contract(adxTokenWeb3.address, ADXToken._json.abi, signer)

		const adxSupplyControllerWeb3 = await ADXSupplyController.new(adxToken.address)
		adxSupplyController = new Contract(
			adxSupplyControllerWeb3.address,
			ADXSupplyController._json.abi,
			signer
		)

		await adxToken.changeSupplyController(adxSupplyController.address)

		const chainlinkWeb3 = await MockChainlink.new()
		const uniswapWeb3 = await MockUniswap.new()
		const stakingPoolWeb3 = await StakingPoolArtifact.new(
			adxToken.address,
			uniswapWeb3.address,
			chainlinkWeb3.address,
			guardianAddr,
			validatorAddr,
			governanceAddr,
			adxToken.address
		)

		stakingPool = new Contract(stakingPoolWeb3.address, StakingPoolArtifact._json.abi, signer)
		chainlink = new Contract(chainlinkWeb3.address, MockChainlink._json.abi, signer)
		uniswap = new Contract(uniswapWeb3.address, MockUniswap._json.abi, signer)
	})

	beforeEach(async function() {
		snapShotId = (await takeSnapshot(web3)).result
	})

	// eslint-disable-next-line no-undef
	afterEach(async function() {
		await revertToSnapshot(web3, snapShotId)
	})

	it('name', async function() {
		assert.equal(await stakingPool.name(), 'AdEx Staking Token', 'invalid name')
	})

	it('decimals', async function() {
		assert.equal(await stakingPool.decimals(), 18, 'invalid decimals')
	})

	it('symbol', async function() {
		assert.equal(await stakingPool.symbol(), 'ADX-STAKING', 'invalid symbol')
	})

	it('guardian', async function() {
		assert.equal(await stakingPool.guardian(), guardianAddr, 'invalid guardian address')
	})

	it('validator', async function() {
		assert.equal(await stakingPool.validator(), validatorAddr, 'invalid validator address')
	})

	it('governance', async function() {
		assert.equal(await stakingPool.governance(), governanceAddr, 'invalid governance address')
	})

	it('setGovernance', async function() {
		expectEVMError(stakingPool.setGovernance(userAcc), 'NOT_GOVERNANCE')
		await stakingPool.connect(governanceSigner).setGovernance(userAcc)

		assert.equal(await stakingPool.governance(), userAcc, 'change governance address')
	})

	it('setDailyPenaltyMax', async function() {
		expectEVMError(stakingPool.setDailyPenaltyMax(1), 'NOT_GOVERNANCE')
		expectEVMError(
			stakingPool.connect(governanceSigner).setDailyPenaltyMax(1000),
			'DAILY_PENALTY_TOO_LARGE'
		)
		const newDailyPenalty = 200
		await stakingPool.connect(governanceSigner).setDailyPenaltyMax(newDailyPenalty)

		assert.equal(
			await stakingPool.MAX_DAILY_PENALTIES_PROMILLES(),
			newDailyPenalty,
			'change penalty max value'
		)
	})

	it('setRageReceived', async function() {
		expectEVMError(stakingPool.setRageReceived(1), 'NOT_GOVERNANCE')
		expectEVMError(stakingPool.connect(governanceSigner).setRageReceived(4000), 'TOO_LARGE')

		const newRageReceived = 300
		await stakingPool.connect(governanceSigner).setRageReceived(newRageReceived)

		assert.equal(
			await stakingPool.RAGE_RECEIVED_PROMILLES(),
			newRageReceived,
			'change rage received value'
		)
	})

	it('setWhitelistedClaimToken', async function() {
		expectEVMError(stakingPool.setWhitelistedClaimToken(anotherUser, true), 'NOT_GOVERNANCE')
		await stakingPool.connect(governanceSigner).setWhitelistedClaimToken(anotherUser, true)

		assert.equal(
			await stakingPool.whitelistedClaimTokens(anotherUser),
			true,
			'set whitelisted claim token'
		)
	})

	it('setGuardian', async function() {
		expectEVMError(stakingPool.setGuardian(anotherUser), 'NOT_GOVERNANCE')
		const receipt = await (await stakingPool
			.connect(governanceSigner)
			.setGuardian(anotherUser)).wait()
		const newGuardianEv = receipt.events.find(x => x.event === 'LogNewGuardian')
		assert.ok(newGuardianEv, 'should emit guardian ev')
		assert.equal(await stakingPool.guardian(), anotherUser, 'set guardian')
	})

	it('approve', async function() {
		const amountToEnter = bigNumberify('1000000')
		await enterStakingPool(userAcc, amountToEnter)
		const amountToApprove = 10
		const receipt = await (await stakingPool.approve(anotherUser, amountToApprove)).wait()
		const approveEv = receipt.events.find(x => x.event === 'Approve')
		assert.ok(approveEv, 'has an approve event')

		// check allowance
		assert.equal(
			(await stakingPool.allowance(anotherUser)).toNumber(),
			amountToApprove,
			'has correct approve amount'
		)
	})

	it('permit', async function() {
		const chainId = (await ethers.getDefaultProvider().getNetwork()).chainId
		const owner = governanceAddr
		const spender = anotherUser
		const value = 10
		const deadline = (await (await governanceSigner.provider.getBlock('latest')).timestamp) + 50000
		const domain = {
			name: 'AdEx Staking Token',
			version: '1',
			chainId,
			verifyingContract: stakingPool.address
		}
		const types = {
			Permit: [
				{ name: 'owner', type: 'address' },
				{ name: 'spender', type: 'address' },
				{ name: 'value', type: 'uint256' },
				{ name: 'nonce', type: 'uint256' },
				{ name: 'deadline', type: 'uint256' }
			]
		}
		const typedData = {
			owner,
			spender,
			value,
			nonce: 0,
			deadline
		}
		// const signature = await governanceSigner.provider
		// 	.send('eth_sign', [
		// 		governanceAddr,
		// 		ethers.utils._TypedDataEncoder.hash(domain, types, typedData)
		// 	])

		const signature = await governanceSigner.signMessage(
			ethers.utils.arrayify(ethers.utils._TypedDataEncoder.hash(domain, types, typedData))
		)

		const hashdomain = ethers.utils._TypedDataEncoder.hashDomain(domain)
		const hashStruct = ethers.utils._TypedDataEncoder.hashStruct('Permit', types, typedData)
		const hashEncoded = ethers.utils.solidityKeccak256(
			['string', 'bytes32', 'bytes32'],
			[`\x19\x01`, hashdomain, hashStruct]
		)

		// console.log('hashEncoded ', hashEncoded)
		// console.log(ethers.utils._TypedDataEncoder.hash(domain, types, typedData))

		const { v, r, s } = ethers.utils.splitSignature(signature)
		// console.log({ governanceAddr })
		// console.log({ userAcc })
		// console.log({ v })
		// console.log({ r })
		// console.log({ s })
		// console.log(`domain`, ethers.utils._TypedDataEncoder.hashDomain(domain).toString('hex'))
		// console.log(
		// 	`struct `,
		// 	ethers.utils._TypedDataEncoder.hashStruct('Permit', types, typedData).toString('hex')
		// )
		// console.log(ethers.utils._TypedDataEncoder.encode(domain, types, typedData).toString('hex'))

		await stakingPool.permit(governanceAddr, anotherUser, value, deadline, v, r, s)
	})

	it('setTimeToUnbond', async function() {
		expectEVMError(stakingPool.setTimeToUnbond(1), 'NOT_GOVERNANCE')
		const threeDaysInSeconds = 259200
		expectEVMError(stakingPool.connect(governanceSigner).setTimeToUnbond(259200 * 30), 'BOUNDS')

		await stakingPool.connect(governanceSigner).setTimeToUnbond(threeDaysInSeconds)

		assert.equal(
			await stakingPool.TIME_TO_UNBOND(),
			threeDaysInSeconds,
			'change time to unbond value'
		)
	})

	it('enter', async function() {
		const amountToEnter = bigNumberify('1000000')
		// set user balance
		await prevToken.setBalanceTo(userAcc, amountToEnter)
		await adxToken.swap(amountToEnter)

		// approve Staking pool
		await (await adxToken.approve(stakingPool.address, parseADX('1000'))).wait()

		const receipt = await (await stakingPool.enter(parseADX('10'))).wait()
		assert.equal(receipt.events.length, 3, 'should emit event')

		assert.equal(
			(await stakingPool.balanceOf(userAcc)).toString(),
			parseADX('10').toString(),
			'should mint equivalent pool tokens'
		)

		// set incentive
		await (await adxSupplyController.setIncentive(stakingPool.address, parseADX('0.1'))).wait()

		await moveTime(web3, DAY_SECONDS * 10)
		await (await stakingPool.enter(parseADX('10'))).wait()

		assert.equal(
			(await stakingPool.balanceOf(userAcc)).toString(),
			'10001157273463719476',
			'should mint additional shares'
		)
	})

	it('enterTo', async function() {
		const amountToEnter = bigNumberify('1000000')
		// set user balance
		await prevToken.setBalanceTo(userAcc, amountToEnter)
		await adxToken.swap(amountToEnter)

		// approve Staking pool
		await (await adxToken.approve(stakingPool.address, parseADX('1000'))).wait()

		const receipt = await (await stakingPool.enterTo(guardianAddr, parseADX('10'))).wait()
		assert.equal(receipt.events.length, 3, 'should emit event')

		assert.equal(
			(await stakingPool.balanceOf(guardianAddr)).toString(),
			parseADX('10').toString(),
			'should mint equivalent pool tokens'
		)
	})

	it('leave', async function() {
		const amountToEnter = bigNumberify('1000000')
		// set user balance
		await prevToken.setBalanceTo(userAcc, amountToEnter)
		await adxToken.swap(amountToEnter)

		// approve Staking pool
		await (await adxToken.approve(stakingPool.address, parseADX('1000'))).wait()
		// enter staking pool
		const sharesToMint = parseADX('10')
		await (await stakingPool.enter(sharesToMint)).wait()

		await expectEVMError(stakingPool.leave(parseADX('10000'), false), 'INSUFFICIENT_SHARES')

		const receipt = await (await stakingPool.leave(sharesToMint, false)).wait()
		const currentBlockTimestamp = (await web3.eth.getBlock('latest')).timestamp
		assert.equal(receipt.events.length, 2, 'should emit LogLeave event')

		const logLeaveEv = receipt.events.find(ev => ev.event === 'LogLeave')
		assert.ok(logLeaveEv, 'should have LogLeave event')
		assert.ok(
			currentBlockTimestamp + (await stakingPool.TIME_TO_UNBOND()).toNumber(),
			logLeaveEv.args.unlocksAt.toNumber(),
			'should have correct unlocksAt'
		)

		const unbondCommitment = new UnbondCommitment({
			...logLeaveEv.args,
			shares: logLeaveEv.args.shares.toString(),
			unlocksAt: logLeaveEv.args.unlocksAt.toString()
		})

		assert.equal(
			(await stakingPool.commitments(unbondCommitment.hashHex())).toString(),
			sharesToMint.toString()
		)

		assert.equal(
			(await stakingPool.lockedShares(logLeaveEv.args.owner)).toString(),
			sharesToMint.toString()
		)
	})

	it('withdraw', async function() {
		const amountToEnter = bigNumberify('1000000')
		await prevToken.setBalanceTo(userAcc, amountToEnter)
		await adxToken.swap(amountToEnter)

		await (await adxToken.approve(stakingPool.address, parseADX('1000'))).wait()
		const sharesToMint = parseADX('10')
		await (await stakingPool.enter(sharesToMint)).wait()

		const leaveReceipt = await (await stakingPool.leave(parseADX('10'), false)).wait()
		const logLeaveEv = leaveReceipt.events.find(ev => ev.event === 'LogLeave')
		await expectEVMError(
			stakingPool.withdraw(sharesToMint, logLeaveEv.args.unlocksAt.toNumber(), false),
			'UNLOCK_TOO_EARLY'
		)

		await moveTime(web3, logLeaveEv.args.unlocksAt.toNumber() + 10)

		await expectEVMError(
			stakingPool.withdraw(sharesToMint, logLeaveEv.args.unlocksAt.toNumber() + 1000, false),
			'NO_COMMITMENT'
		)

		const withdrawReceipt = await (await stakingPool.withdraw(
			sharesToMint,
			logLeaveEv.args.unlocksAt.toNumber(),
			false
		)).wait()

		const logWithdrawEv = withdrawReceipt.events.find(ev => ev.event === 'LogWithdraw')
		assert.ok(logWithdrawEv, 'should have LogWithdraw ev')

		const unbondCommitment = new UnbondCommitment({
			...logLeaveEv.args,
			shares: logLeaveEv.args.shares.toString(),
			unlocksAt: logLeaveEv.args.unlocksAt.toString()
		})

		assert.equal((await stakingPool.commitments(unbondCommitment.hashHex())).toString(), '0')

		assert.equal((await stakingPool.lockedShares(logLeaveEv.args.owner)).toString(), '0')
		// @TODO check shares amount
	})

	it('rageLeave', async function() {
		const amountToEnter = bigNumberify('1000000')
		await prevToken.setBalanceTo(userAcc, amountToEnter)
		await adxToken.swap(amountToEnter)

		await (await adxToken.approve(stakingPool.address, parseADX('1000'))).wait()
		const sharesToMint = parseADX('10')
		await (await stakingPool.enter(sharesToMint)).wait()
		const currentBalance = await adxToken.balanceOf(userAcc)
		const leaveReceipt = await (await stakingPool.rageLeave(parseADX('10'), false)).wait()
		const logRageLeaveEv = leaveReceipt.events.find(ev => ev.event === 'LogRageLeave')

		// @TODO confirm received Tokens
		assert.equal(
			(await adxToken.balanceOf(userAcc)).toString(),
			currentBalance.add(logRageLeaveEv.args.receivedTokens).toString(),
			'should receive tokens'
		)
	})

	it('claim', async function() {
		const amountToEnter = bigNumberify('1000000')
		await prevToken.setBalanceTo(userAcc, amountToEnter)
		await adxToken.swap(amountToEnter)

		await (await adxToken.approve(stakingPool.address, parseADX('1000'))).wait()
		const sharesToMint = parseADX('30')
		await (await stakingPool.enter(sharesToMint)).wait()

		await expectEVMError(
			stakingPool.claim(prevToken.address, guardianAddr, parseADX('8')),
			'NOT_GUARDIAN'
		)

		await expectEVMError(
			stakingPool
				.connect(web3Provider.getSigner(guardianAddr))
				.claim(prevToken.address, guardianAddr, parseADX('8')),
			'TOKEN_NOT_WHITELISTED'
		)

		await expectEVMError(
			stakingPool
				.connect(web3Provider.getSigner(guardianAddr))
				.claim(adxToken.address, guardianAddr, parseADX('100')),
			'INSUFFICIENT_ADX'
		)

		await stakingPool.connect(governanceSigner).setDailyPenaltyMax(1)

		const receipt = await (await stakingPool
			.connect(web3Provider.getSigner(guardianAddr))
			.claim(adxToken.address, guardianAddr, parseADX('8'))).wait()

		// eslint-disable-next-line no-console
		console.log(`claim gasUsed; ${receipt.gasUsed.toString()}`)
	})

	it('penalize', async function() {
		const amountToEnter = bigNumberify('1000000')
		await prevToken.setBalanceTo(userAcc, amountToEnter)
		await adxToken.swap(amountToEnter)

		await (await adxToken.approve(stakingPool.address, parseADX('1000'))).wait()
		const sharesToMint = parseADX('30')
		await (await stakingPool.enter(sharesToMint)).wait()

		await expectEVMError(stakingPool.penalize(parseADX('8')), 'NOT_GUARDIAN')
	})
})
