#!/usr/bin/env node

/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
const ethers = require('ethers')
const assert = require('assert')
const throttle = require('lodash.throttle')
const fetch = require('node-fetch')
const qs = require('querystring')
const db = require('./db')
const AdExCore = require('../../abi/AdExCore.json')
const OracleAbi = require('../../abi/EarningOracle.json')
const {
	getQueryBlockHeight,
	createChannelIfNotExistsAndUpdateEarner,
	setFetchBlockHeight,
	getChannelEarners
} = require('./db')

const {
	INFURA_PROJECT_ID,
	LOGS_INFURA_PROJECT_ID,
	ETHERSCAN_API_TOKEN,
	WEB3_NODE_URL,
	NETWORK = 'localhost',
	PRIVATE_KEY
} = process.env

assert.ok(PRIVATE_KEY, 'PRIVATE_KEY required')

const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json'
const CORE_ADDRESS = process.env.core_address || '0xE9Cf75B656176f346dfc21439986888030f783Bf' // @TODO update
const ORACLE_ADDRESS = process.env.oracle_address || '0xA3AF7DCc21b902b9a9a0B0f41b7f4eA9CFC3aB9b' // @TODO update

const provider = (() => {
	if (INFURA_PROJECT_ID) {
		return new ethers.providers.InfuraProvider(NETWORK, INFURA_PROJECT_ID)
	}
	if (ETHERSCAN_API_TOKEN) {
		return new ethers.providers.EtherscanProvider(NETWORK, ETHERSCAN_API_TOKEN)
	}
	if (WEB3_NODE_URL) {
		return new ethers.providers.JsonRpcProvider(WEB3_NODE_URL)
	}
	return ethers.getDefaultProvider(NETWORK)
})()

const notify = throttle(message => {
	// eslint-disable-next-line no-console
	console.log(message)
	if (NETWORK === 'goerli' || NETWORK === 'localhost') {
		return
	}
	const token = process.env.PUSHOVER_TOKEN
	const user = process.env.PUSHOVER_USER
	const body = qs.stringify({ token, user, message: `${NETWORK}: ${message}` })
	// eslint-disable-next-line consistent-return
	return fetch(PUSHOVER_URL, {
		method: 'POST',
		body,
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
	})
}, 60 * 60 * 1000)

const providerLogs = LOGS_INFURA_PROJECT_ID
	? new ethers.providers.InfuraProvider(NETWORK, LOGS_INFURA_PROJECT_ID)
	: provider

const signer = new ethers.Wallet(PRIVATE_KEY, providerLogs)
const Core = new ethers.Contract(CORE_ADDRESS, AdExCore, signer)
const Oracle = new ethers.Contract(ORACLE_ADDRESS, OracleAbi, signer)
const CORE_BLOCK_HEIGHT = 0

async function listenChannelWithdraw() {
	const INCR_BLOCK = 1000000

	let fetchBlockHeight = (await getQueryBlockHeight()) || CORE_BLOCK_HEIGHT
	const currentBlockHeight = await providerLogs.getBlockNumber('latest')
	const evs = Core.interface.events

	const expiredChannelIds = []

	while (fetchBlockHeight < currentBlockHeight) {
		const newBlockHeight =
			currentBlockHeight - fetchBlockHeight > INCR_BLOCK
				? fetchBlockHeight + INCR_BLOCK
				: currentBlockHeight
		const logs = await provider.getLogs({
			fromBlock: fetchBlockHeight,
			toBlock: newBlockHeight,
			address: CORE_ADDRESS
		})

		// eslint-disable-next-line no-await-in-loop
		for (const log of logs) {
			const topic = log.topics[0]
			if (topic === evs.LogChannelWithdraw.topic) {
				const { channelId } = Core.interface.parseLog(log).values
				const { from: earner } = await provider.getTransaction(log.transactionHash)

				await createChannelIfNotExistsAndUpdateEarner(channelId, earner)
			} else if (topic === evs.LogChannelWithdrawExpired.topic) {
				const { channelId } = Core.interface.parseLog(log).values
				expiredChannelIds.push(channelId)
			}
		}
		fetchBlockHeight = newBlockHeight
	}

	await sendOracleBulkUpdateTransaction(expiredChannelIds).catch(e =>
		notify(`Oracle ${e.toString()}`)
	)
	await setFetchBlockHeight(fetchBlockHeight)

	if (expiredChannelIds.length) {
		notify(`Oracle successfully updated ${expiredChannelIds.length} expired channels`)
	}
}

async function sendOracleBulkUpdateTransaction(channelIds) {
	if (!channelIds.length) return
	const earners = await Promise.all(channelIds.map(async channelId => getChannelEarners(channelId)))
	await Oracle.bulkUpdate(channelIds, earners)
}

async function init() {
	await db.connect()

	setInterval(() => {
		listenChannelWithdraw()
	}, 5 * 60 * 1000) // every 5 minutes
}

init()
