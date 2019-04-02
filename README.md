# adex-protocol-eth

The Ethereum implementation of the [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol).

This replaces [adex-core](https://github.com/AdExNetwork/adex-core).

This repository implements [OUTPACE](https://github.com/AdExNetwork/adex-protocol/blob/master/OUTPACE.md) (off-chain unidirectional trustless payment channel) and a gas abstraction layer called [AdEx Identity](https://github.com/AdExNetwork/adex-protocol/issues/10).

### Please note

* Every channel will eventually expire (after `validUntil`), allowing the non-withdrawn portion of the initial deposit to be received back by whoever opened the channel.
* Channels can be created with any ERC20 token; if the underlying token of a channel is insecure or malicious, that also compromises the channel as well; this is out of scope of this contract, since this is a fundamental issue with any system that uses ERC20's; needless to say, the user needs to be aware of what token they're using/earning
* For more details on how OUTPACE channels work, please read the specs: [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol) and [OUTPACE](https://github.com/AdExNetwork/adex-protocol/blob/master/OUTPACE.md).

## Testing

```
truffle build # This is important cause js/IdentityProxyDeploy uses artifacts from there
npm test
```

## Deployment

The contract `extra/Identity` is supposed to be deployed separately for each user through a counterfactual method described in [AdEx Identity](https://github.com/AdExNetwork/adex-protocol/issues/10).

The contract `AdExCore` from version v2.3.0, compiled with solc v0.5.6 is deployed here:

* Mainnet: https://etherscan.io/address/0x333420fc6a897356e69b62417cd17ff012177d2b
* Goerli: https://goerli.etherscan.io/address/0x333420fc6a897356e69b62417cd17ff012177d2b
* Kovan: https://kovan.etherscan.io/address/0x333420fc6a897356e69b62417cd17ff012177d2b

### Deployment strategy

The full deploy processis as follows

* Deploy AdExCore
* Deploy an IdentityFactory
* Deploy a single Identity, with no owners and no registry
* Deploy a Registry

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

## Credits

* @BrendanChou for SafeERC20: https://gist.github.com/BrendanChou/88a2eeb80947ff00bcf58ffdafeaeb61
* @decanus for SignatureValidator
* @ConnextProject for `merkletree.js`
