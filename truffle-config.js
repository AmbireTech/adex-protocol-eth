/**
 * Use this file to configure your truffle project. It's seeded with some
 * common settings for different networks and features like migrations,
 * compilation and testing. Uncomment the ones you need or modify
 * them to suit your project as necessary.
 *
 * More information about configuration can be found at:
 *
 * truffleframework.com/docs/advanced/configuration
 *
 * To deploy via Infura you'll need a wallet provider (like truffle-hdwallet-provider)
 * to sign your transactions before they're sent to a remote public node. Infura API
 * keys are available for free at: infura.io/register
 *
 *   > > Using Truffle V5 or later? Make sure you install the `web3-one` version.
 *
 *   > > $ npm install truffle-hdwallet-provider@web3-one
 *
 * You'll also need a mnemonicOrKeys - the twelve word phrase the wallet uses to generate
 * public/private key pairs. If you're publishing your code to GitHub make sure you load this
 * phrase from a file you've .gitignored so it doesn't accidentally become public.
 *
 */

// const HDWallet = require('truffle-hdwallet-provider');
// const infuraKey = "fj4jll3k.....";
//
// const fs = require('fs');
// const mnemonicOrKeys = fs.readFileSync(".secret").toString().trim();

const HDWalletProvider = require('@truffle/hdwallet-provider')
const fs = require('fs')

let mnemonicOrKeys
try {
	mnemonicOrKeys = fs
		.readFileSync('.deployKey')
		.toString()
		.trim()
	if (mnemonicOrKeys.length === 64) mnemonicOrKeys = [mnemonicOrKeys]
	// causes stuff to blow up cause we don't catch the errors from the provider
	// console.log('Deploy addr:', (new HDWalletProvider(mnemonicOrKeys, 'wss://matic-mainnet-archive-ws.bwarelabs.com')).addresses[0])
} catch (e) {
	console.error('WARNING: unable to read .deploykey, mainnet wont work', e)
}

module.exports = {
	/**
	 * Networks define how you connect to your ethereum client and let you set the
	 * defaults web3 uses to send transactions. If you don't specify one truffle
	 * will spin up a development blockchain for you on port 9545 when you
	 * run `develop` or `test`. You can ask a truffle command to use a specific
	 * network from the command line, e.g
	 *
	 * $ truffle test --network <network-name>
	 */

	networks: {
		// Useful for testing. The `development` name is special - truffle uses it by default
		// if it's defined here and no other network is specified at the command line.
		// You should run a client (like ganache-cli, geth or parity) in a separate terminal
		// tab if you use this network and you must also set the `host`, `port` and `network_id`
		// options below to some value.
		//
		development: {
			host: 'localhost',
			port: 8545,
			network_id: '*', // Match any network id
			gas: 6000000,
			gasPrice: 10000000000
		},
		// development: {
		//  host: "127.0.0.1",     // Localhost (default: none)
		//  port: 8545,            // Standard Ethereum port (default: none)
		//  network_id: "*",       // Any network (default: none)
		// },

		// Another network with more advanced options...
		advanced: {
			// port: 8777,             // Custom port
			// network_id: 1342,       // Custom network
			// gas: 8500000,           // Gas sent with each transaction (default: ~6700000)
			// gasPrice: 20000000000,  // 20 gwei (in wei) (default: 100 gwei)
			// from: <address>,        // Account to send txs from (default: accounts[0])
			// websockets: true        // Enable EventEmitter interface for web3 (default: false)
		},

		// Useful for deploying to a public network.
		// NB: It's important to wrap the provider as a function.
		ropsten: {
			// provider: () => new HDWalletProvider(mnemonicOrKeys, `https://ropsten.infura.io/${infuraKey}`),
			// network_id: 3,       // Ropsten's id
			// gas: 5500000,        // Ropsten has a lower block limit than mainnet
			// confirmations: 2,    // # of confs to wait between deployments. (default: 0)
			// timeoutBlocks: 200,  // # of blocks before a deployment times out  (minimum/default: 50)
			// skipDryRun: true     // Skip dry run before migrations? (default: false for public nets )
		},

		// Useful for private networks
		private: {
			// provider: () => new HDWalletProvider(mnemonicOrKeys, `https://network.io`),
			// network_id: 2111,   // This network is yours, in the cloud.
			// production: true    // Treats this network as if it was a public net. (default: false)
		},

		mainnet: {
			provider: () =>
				new HDWalletProvider(
					mnemonicOrKeys,
					'wss://mainnet.infura.io/ws/v3/3d22938fd7dd41b7af4197752f83e8a1'
				),
			network_id: 1,
			gasPrice: 95e9, // in gwei
			gasLimit: 2000000
		},

		goerli: {
			provider: () =>
				new HDWalletProvider(
					mnemonicOrKeys,
					'wss://goerli.infura.io/ws/v3/3d22938fd7dd41b7af4197752f83e8a1'
				),
			network_id: 5,
			gasPrice: 5e9
		},

		polygon: {
			provider: () =>
				new HDWalletProvider(
					mnemonicOrKeys,
					'https://rpc-mainnet.maticvigil.com/v1/a5ab110a213caf96d58376b2ab55f37e9b61eb64'
				),
			network_id: 137,
			gasLimit: 2000000,
			gasPrice: 110e9
		},

		bsc: {
			provider: () => new HDWalletProvider(mnemonicOrKeys, 'https://bsc-dataseed1.binance.org'),
			network_id: 56,
			gasPrice: 5e9
		}
	},

	// Set default mocha options here, use special reporters etc.
	mocha: {
		// timeout: 100000
	},

	// Configure your compilers
	compilers: {
		solc: {
			version: '0.8.7', // Fetch exact version from solc-bin (default: truffle's version)
			// docker: true,        // Use "0.5.1" you've installed locally with docker (default: false)
			settings: {
				// See the solidity docs for advice about optimization and evmVersion
				optimizer: {
					enabled: true,
					runs: 200
				},
				evmVersion: 'istanbul'
			}
		}
	}
}
