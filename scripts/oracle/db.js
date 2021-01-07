const { MongoClient } = require('mongodb')

const url = process.env.DB_MONGO_URL || 'mongodb://localhost:27017'
const dbName = process.env.DB_MONGO_NAME || 'earningOracle'
const CHANNEL_COLLECTION = 'oracleChannels'
const BLOCK_HEIGHT_COLLECTION = 'height'

let mongoClient = null

function connect() {
	return MongoClient.connect(url, { useNewUrlParser: true }).then(function(client) {
		mongoClient = client
	})
}

function getMongo() {
	if (mongoClient) return mongoClient.db(dbName)
	throw new Error('db.connect() needs to be invoked before using getMongo()')
}

function close() {
	return mongoClient.close()
}

async function channelExists(channelId) {
	const col = getMongo().collection('oracleChannels')
	const exists = await col.findOne({ _id: channelId })
	return !!exists
}

async function createChannel(channelId, earner) {
	if (await channelExists(channelId)) return null

	const col = getMongo().collection('oracleChannels')
	const doc = {
		_id: channelId,
		earners: [earner]
	}
	return col.insertOne(doc)
}

async function updateChannelEarners(channelId, earner) {
	const col = getMongo().collection(CHANNEL_COLLECTION)
	return col.updateOne({ _id: channelId }, { $addToSet: { earners: earner } })
}

async function getChannelEarners(channelId) {
	const col = getMongo().collection(CHANNEL_COLLECTION)
	const data = await col.findOne({ _id: channelId })
	return data && data.earners
}

async function createChannelIfNotExistsAndUpdateEarner(channelId, earner) {
	if (!(await createChannel(channelId, earner))) return updateChannelEarners(channelId, earner)
	return createChannel(channelId, earner)
}

async function setFetchBlockHeight(height) {
	const col = getMongo().collection(BLOCK_HEIGHT_COLLECTION)

	if (!(await col.findOne({ _id: 'currentHeight' }))) {
		await col.insertOne({
			_id: 'currentHeight',
			height
		})
		return
	}
	await col.updateOne({ _id: 'currentHeight' }, { $set: { height } })
}

async function getQueryBlockHeight() {
	const col = getMongo().collection(BLOCK_HEIGHT_COLLECTION)
	const data = await col.findOne({ _id: 'currentHeight' })
	return data && data.height
}

module.exports = {
	connect,
	getMongo,
	close,
	setFetchBlockHeight,
	getQueryBlockHeight,
	createChannel,
	updateChannelEarners,
	createChannelIfNotExistsAndUpdateEarner,
	getChannelEarners
}
