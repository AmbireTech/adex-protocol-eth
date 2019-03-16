# adex-protocol-eth

The Ethereum implementation of the [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol).

This replaces [adex-core](https://github.com/AdExNetwork/adex-core).

This repository implements [OUTPACE](https://github.com/AdExNetwork/adex-protocol/blob/master/OUTPACE.md) (off-chain unidirectional trustless payment channel) and a gas abstraction layer called [AdEx Identity](https://github.com/AdExNetwork/adex-protocol/issues/10).

### Please note

* Every channel will eventually expire (after `validUntil`), allowing the non-withdrawn portion of the initial deposit to be received back by whoever opened the channel.
* Channels can be created with any ERC20 token; if the underlying token of a channel is insecure or malicious, that also compromises the channel as well; this is out of scope of this contract, since this is a fundamental issue with any system that uses ERC20's; needless to say, the user needs to be aware of what token they're using/earning
* For more details on how OUTPACE channels work, please read the specs: [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol) and [OUTPACE](https://github.com/AdExNetwork/adex-protocol/blob/master/OUTPACE.md).


## Deployment

The contract `AdExCore` will be deployed to a testnet first (Kovan), and a month after we should have it on mainnet as well.

The contract `extra/Identity` is supposed to be deployed separately for each user through a counterfactual method described in [AdEx Identity](https://github.com/AdExNetwork/adex-protocol/issues/10).


### Kovan

https://kovan.etherscan.io/address/0xe6aa464334a067f52e44f7b6dabb91804371376c#readContract

### Verifying on etherscan

```
truffle compile
cat build/contracts/AdExCore.json | jq '.bytecode' # this is the bytecode you have to deploy
./scripts/bundle.sh contracts/AdExCore.sol # this will output a bundled .sol code
```

### Gas usage, from the tests

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
