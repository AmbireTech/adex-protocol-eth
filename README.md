# adex-protocol-eth

The Ethereum implementation of the [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol).

This replaces [adex-core](https://github.com/AdExNetwork/adex-core).

This repository implements [OUTPACE](https://github.com/AdExNetwork/adex-protocol/blob/master/OUTPACE.md) (off-chain unidirectional trustless payment channel) and a gas abstraction layer called [AdEx Identity](https://github.com/AdExNetwork/adex-protocol/issues/10).

### Please note

* Every channel will eventually expire (after `validUntil`), allowing the non-withdrawn portion of the initial deposit to be received back by whoever opened the channel.
* Channels can be created with any ERC20 token; if the underlying token of a channel is insecure or malicious, that also compromises the channel as well; this is out of scope of this contract, since this is a fundamental issue with any system that uses ERC20's; needless to say, the user needs to be aware of what token they're using/earning
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

* Goerli: https://goerli.etherscan.io/address/0x96e3cb4b4632ed45363ff2c9f0fbec9b583d9d3a

An `IdentityFactory`, set up with the AdEx relayer:

* Goerli: https://goerli.etherscan.io/address/0xd5a1c8a5ea507ea459216ff34939cae3326dba6f

And the `Staking`:

* Goerli (TST token and creator as a slasher): https://goerli.etherscan.io/address/0x0d1ba07d3eb0ae02999a4dec7b71ddd7b9e0431d

### Deployment strategy

The full deploy processis as follows

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
```

### ENS

This is not a part of the adex-protocol-eth source code, but it may be useful for anyone building on top of adex-protocol-eth who wishes to integrate with ENS.

* ENS Contract mainnet address: 0x314159265dd8dbb310642f98f50c066173c1259b
* ENS PublicResolve mainnet address: 0x226159d592E2b063810a10Ebf6dcbADA94Ed68b8
* adex.eth node hash: 0x4e4e818e9467df5c5d1f8c399b11acc73ea24ad69e9c8e1ba6e5784a302c47d4
* adex.eth subdomain registrar (adex.eth controller), compiled with solc v0.5.6: [0xa3f69f48d4a45419d48b56b1cfbf4af2d4586728](https://etherscan.io/address/0xa3f69f48d4a45419d48b56b1cfbf4af2d4586728#code)

## Audits

* [G0 Group](https://github.com/g0-group/Audits/blob/master/AdExNetwork.md): all issues discovered were of Low severity, and all were resolved
* [Sigma Prime](https://github.com/sigp/public-audits/blob/master/adex/review.pdf): 4 issues discovered with "Informational" severity, all resolved
* [G0 Group, Staking contract](https://github.com/g0-group/Audits/blob/master/G0Group-AdExStaking.pdf): all issues discovered were resolved

## Credits

* @BrendanChou for SafeERC20: https://gist.github.com/BrendanChou/88a2eeb80947ff00bcf58ffdafeaeb61
* @decanus for SignatureValidator
* @ConnextProject for `merkletree.js`
