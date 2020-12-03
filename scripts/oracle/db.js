const { MongoClient } = require('mongodb')

const url = process.env.DB_MONGO_URL || 'mongodb://localhost:27017'
const dbName = process.env.DB_MONGO_NAME || 'earningOracle'

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

module.exports = { connect, getMongo, close }
