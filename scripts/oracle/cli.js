const ethers = require('ethers')
const assert = require('assert')
const AdExCore = require('../../abi/AdExCore.json')
const Oracle = require('../../abi/EarningOracle.json')

const CORE_ADDRESS = '0x'
const ORACLE_ADDRESS = '0x'

const signer =  null
const core = new ethers.Contract(CORE_ADDRESS, AdExCore._json.abi, signer)
const oracle = new ethers.Contract(ORACLE_ADDRESS, Oracle.__json.abi, signer)

async function listen() {

}

async function submitEarnings() {

}

async function start() {

}