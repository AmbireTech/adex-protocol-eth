# JS libraries

TODO: split in a separate repo with npm `package.json`

---
## Descriptions
JavaScript libraries based on the ETH implementation of the protocol.

## Channel

### Channel States:
Unknown: the channel does not exist yet
Active: the channel exists, has a deposit, and it's within the valid period
Expired: the channel exists, but it's no longer valid
[(for more information)](https://github.com/AdExNetwork/adex-protocol#ocean-based-unidirectional-trust-less-payment-channel-outpace)

### Constructor arguments

- `creator` - Address of the creator of the channel
- `tokenAddress` - Address of the token that will be used for the channel
- `tokenAmount` - Total monetary deposit of `tokenAddress`
- `validUntil` - the date until this channel is valid; this is also the period within the publishers can withdraw, so it should be longer than the actual specified campaign length (e.g. 3x longer)
- `validators` -an array of all the validators who are responsible for signing a new state; one of them should represent the advertiser, and the other - the publisher(s)
- `spec` - describes all the campaign criteria: e.g. buy as many impressions as possible, the maximum price they're willing to pay for impressions, and campaign duration; this is stored as arbitrary bytes (32); in the platform, we encode the criteria directly in there, but it can be used to reference a JSON descriptor stored on IPFS.

### Methods
- `hash(contractAddr)` - Returns a hash of the channel properties + the contract address so it is not replayable
- `hashHex(contractAddr)` - Returns a hex string of the hash of a contract address
- `toSolidityTuple()` - Returns an array containing the creator address, token address, hex string of token amount, hex string of validUntil, channel validators, and channel spec
- `hashToSign(contractAddr, stateRoot)` - Returns a hash of the contract address and the state root for signing
- `hashToSignHex(contractAddr, stateRoot)` - Returns a hex string of hashToSign
- `getBalanceLeaf(acc, amount)` - Returns a hash of the of a certain address (acc) and the balance of that address from the tree

---

## Identity
The Identity layer is currently specific to our Ethereum implementation and designed to streamline the user experience of the Platform.

It is a smart contract that allows the users of the Platform (publishers/advertisers) to:

Use many devices (e.g. PC, mobile, HW wallet) as one identity, without having to share the same private key between them
Interact with the Ethereum network without needing to have ETH
Allow certain actions to be scheduled/performed automatically without needing them to be online, for example withdrawing funds from OUTPACE channels
This solves many UX hurdles that are typical for blockchain-related applications.

Some of these concepts are known to the Ethereum community as "meta tx" or "gas abstractions".

Contains `Transaction` and `RoutineAuthorization` objects


### Transaction
Describes transactions made by user

#### Constructor Arguments
- `identityContract` - Ethereum address of the user
- `nonce` - Cryptographic nonce
- `feeTokenAddr` - Ethereum address of the token used for the fee
- `feeTokenAmount` - Amount of token used for the fee
- `to` - Ethereum address of receiver
- `value` - ETH to transfer to the destination, if any
- `data` - Arguments to the smart contract, all of the code is put here

#### Methods
- `hash()` - Returns a hash of the transaction arguments
- `hashHex()` - Returns a hex string of the transaction hash
- `toSolidityTuple()` - Returns an array of the identityContract address, hex string of the nonce, the token address, hex string of the token amount, receiver address, hex string of the value and hex string of the data

### Routine Authorization
Describes an object of routines ran on the identity contract (ex. withdrawing from channels, opening channels).

#### Constructor Arguments
- `relayer` - Address of the relayer through which the routines are ran
- `outpace` - Address of the outpace channel for which the routines run
- `registry` - Address of the registry
- `validUntil` - Date until the channel is valid, expires after that.
- `feeTokenAddr` - Address of the token used for the fee
- `weeklyFeeAmount` - Weekly fee amount

#### Methods
- `hash()` - Returns a hash of the routine authorization arguments
- `hashHex()` - Returns a hex string of the routine authorization hash
- `toSolidityTuple()` - Returns an array of the relayer address, outpace channel address, registry address, hex string of the validUntil date, the fee token address, hex string of the weekly fee amount

#### Routine Operations
- `channelWithdraw` - Withdraws from a channel
- `channelWithdrawExpired` - Withdraws from an expired channel
- `channelOpen` - Opens a channel.
- `withdraw` - Withdraws from identity contract
