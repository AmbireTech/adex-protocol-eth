# adex-protocol-eth

The Ethereum implementation of the [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol).

This replaces [adex-core](https://github.com/AdExNetwork/adex-core).

This repository implements [OUTPACE](https://github.com/AdExNetwork/adex-protocol/blob/master/OUTPACE.md) (off-chain unidirectional trustless payment channel) and a gas abstraction layer called [AdEx Identity](https://github.com/AdExNetwork/adex-protocol/issues/10).

### Please note

* Every channel will eventually expire (after `validUntil`), allowing the non-withdrawn portion of the initial deposit to be received back by whoever opened the channel.
* Channels can be created with any ERC20 token; if the underlying token of a channel is insecure or malicious, that also compromises the channel as well; this is out of scope of this contract, since this is a fundamental issue with any system that uses ERC20s; needless to say, the user needs to be aware of what token they're using/earning
* For more details on how OUTPACE channels work, please read the specs: [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol) and [OUTPACE](https://github.com/AdExNetwork/adex-protocol/blob/master/OUTPACE.md).

## Testing

First, run `ganache-cli` in a separate terminal

```
truffle build # This is important cause js/IdentityProxyDeploy uses artifacts from there
npm test
```

## Deployment

The contract `AdExCore` from version v3.1.0, compiled with solc v0.5.6 is deployed here:

* Mainnet: https://etherscan.io/address/0x333420fc6a897356e69b62417cd17ff012177d2b
* Goerli: https://goerli.etherscan.io/address/0x333420fc6a897356e69b62417cd17ff012177d2b
* Kovan: https://kovan.etherscan.io/address/0x333420fc6a897356e69b62417cd17ff012177d2b

An `Identity`, initialized with no privileges, to be used as a basis for `IdentityProxy`:

* Mainnet: https://etherscan.io/address/0xbdf97b0f5fa78beae684d9fb67dd45f11b996e46
* Goerli: https://goerli.etherscan.io/address/0xbdf97b0f5fa78beae684d9fb67dd45f11b996e46

An `IdentityFactory`, set up with the AdEx relayer:

* Mainnet: https://etherscan.io/address/0x801dbbb2fcbf9f4c3865c6ba5c5012ee19ec283a
* Goerli: https://goerli.etherscan.io/address/0x801dbbb2fcbf9f4c3865c6ba5c5012ee19ec283a

And the `Registry` (now obsolete, no longer used):

* Mainnet: https://etherscan.io/address/0x7671db0a70fa0196071d634f26971b9371627dc0
* Goerli: https://goerli.etherscan.io/address/0x7671db0a70fa0196071d634f26971b9371627dc0

### v4.1

All contracts here were compiled with solc v0.5.13.

The `Identity`, initialized with no privileges, to be used as a basis for `IdentityProxy`:

* Mainnet: https://etherscan.io/address/0x96e3cb4b4632ed45363ff2c9f0fbec9b583d9d3a
* Goerli: https://goerli.etherscan.io/address/0x96e3cb4b4632ed45363ff2c9f0fbec9b583d9d3a

An `IdentityFactory`, set up with the AdEx relayer:

* Mainnet: https://etherscan.io/address/0xd5a1c8a5ea507ea459216ff34939cae3326dba6f
* Goerli: https://goerli.etherscan.io/address/0xd5a1c8a5ea507ea459216ff34939cae3326dba6f

And the `Staking`:

* Mainnet (ADX token and the AdEx multisig as slasher): https://etherscan.io/address/0x46ad2d37ceaee1e82b70b867e674b903a4b4ca32
* Goerli (TST token and creator as a slasher): https://goerli.etherscan.io/address/0x46ad2d37ceaee1e82b70b867e674b903a4b4ca32

### v4.2

The `ADXSupplyController` contract:

* Mainnet: https://etherscan.io/address/0x360625ba7bce57f74eb5501fd2b75db8f85a85d8
* Goerli: https://goerli.etherscan.io/address/0x360625ba7bce57f74eb5501fd2b75db8f85a85d8

The `ADXToken` contract:

* Mainnet: https://etherscan.io/address/0xade00c28244d5ce17d72e40330b1c318cd12b7c3
* Goerli: https://goerli.etherscan.io/address/0xade00c28244d5ce17d72e40330b1c318cd12b7c3

An instance of `IdentityFactory` used for staking:

* Mainnet: https://etherscan.io/address/0x9fe0d438e3c29c7cff949ad8e8da9403a531cc1a
* Goerli: https://goerli.etherscan.io/address/0x9fe0d438e3c29c7cff949ad8e8da9403a531cc1a

The `Staking` contract:
* Mainnet (ADX token and the AdEx multisig as slasher): https://etherscan.io/address/0x4846c6837ec670bbd1f5b485471c8f64ecb9c534
* Goerli (TST token and creator as a slasher): https://goerli.etherscan.io/address/0x4846c6837ec670bbd1f5b485471c8f64ecb9c534

The `ADXFlashLoans` contract:
* Mainnet: https://etherscan.io/address/0xae4c306ce6641e1276c57473f2c2953841f0856a
* Goerli: https://goerli.etherscan.io/address/0xae4c306ce6641e1276c57473f2c2953841f0856a

The `ADXLoyaltyPoolToken` contract:
* Mainnet: https://etherscan.io/address/0xd9a4cb9dc9296e111c66dfacab8be034ee2e1c2c
* Goerli: https://goerli.etherscan.io/address/0xd9a4cb9dc9296e111c66dfacab8be034ee2e1c2c

The `ADXLoyaltyPoolIncentiveController` contract:
* Mainnet: https://etherscan.io/address/0x57ecd1f90b1298f374737f0d7dd6aabb11b41c0f
* Goerli: https://goerli.etherscan.io/address/0x57ecd1f90b1298f374737f0d7dd6aabb11b41c0f


### Deployment strategy

The full deploy process is as follows

* Deploy AdExCore
* Deploy an IdentityFactory
* Deploy a single Identity, with no owners and no registry
* Deploy a Staking

### Verifying on etherscan

```
truffle compile
cat build/contracts/AdExCore.json | jq '.bytecode' # this is the bytecode you have to deploy
./scripts/bundle.sh contracts/AdExCore.sol # this will output a bundled .sol code
```

### Gas usage, from the tests

Measured with solc v0.5.6, commit d80fa80424ef7b8932399424f8d919d67b135a30

```
channelOpen: 69961
channelWithdrawExpired: 70470
channelWithdraw: 137117
execute: 89900
execRoutines: 114440
channelOpen, through execute: 115086
deploying an identity proxy through the IdentityFactory: 127549
```

### ENS

This is not a part of the adex-protocol-eth source code, but it may be useful for anyone building on top of adex-protocol-eth who wishes to integrate with ENS.

* ENS Contract mainnet address: 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
* ENS PublicResolve mainnet address: 0x226159d592E2b063810a10Ebf6dcbADA94Ed68b8
* adex.eth node hash: 0x4e4e818e9467df5c5d1f8c399b11acc73ea24ad69e9c8e1ba6e5784a302c47d4
* adex.eth subdomain registrar (adex.eth controller), compiled with solc v0.5.6: [0x7bc082552b1a195813ddb500600ce2b544d579cb](https://etherscan.io/address/0x7bc082552b1a195813ddb500600ce2b544d579cb)

## Code style and design principles

* Minimalistic use of smart contracts in general
   * Avoid putting logic in SCs if it's outcome is controlled by a single entity anyway
   * Do not add complexity and centralization to address various "what ifs" that should be addressed off-chain, e.g. "what if users send tokens to this contract by accident"
* Detailed tests for every contract
* No Solidity warnings allowed
* No modifiers allowed
* Limited use of inheritance
* No reentrancy guards allowed, instead we use the Checks-Effects-Interactions pattern
* All `require`s should have an error message
* No `delegatecall` upgradability; upgradability is achieved via off-chain social consensus
* No emergency stops or pausability: it dilutes the value of smart contracts

## Audits

* [G0 Group](https://github.com/g0-group/Audits/blob/master/AdExNetwork.md): all issues discovered were of Low severity, and all were resolved
* [Sigma Prime](https://github.com/sigp/public-audits/blob/master/adex/review.pdf): 4 issues discovered with "Informational" severity, all resolved
* [G0 Group, Staking contract](https://github.com/g0-group/Audits/blob/master/G0Group-AdExStaking.pdf): all issues discovered were resolved
* [Forkway, ADXToken](https://github.com/AdExNetwork/adex-protocol-eth/blob/master/audits/Forkway_ADXToken_audit.pdf): all issues discovered were informational and resolved
* [Forkway, ADXLoyaltyPoolToken](https://github.com/AdExNetwork/adex-protocol-eth/blob/master/audits/forkway-loyalty-pool.md): all issues discovered were resolved

## Credits

* @BrendanChou for SafeERC20: https://gist.github.com/BrendanChou/88a2eeb80947ff00bcf58ffdafeaeb61
* @decanus for SignatureValidator
* @ConnextProject for `merkletree.js`
