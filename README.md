# adex-protocol-eth

The Ethereum implementation of the [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol).

This replaces [adex-core](https://github.com/AdExNetwork/adex-core).

This relies on the concept of OCEAN, which stands for off-chain event aggregation and OUTPACE (off-chain unidirectional trustless payment channel)

### Please note

Every channel will eventually expire (after `validUntil`), allowing the non-withdrawn portion of the initial deposit to be received back by whoever opened the channel.

## Deployment

This will be deployed to Ropsten first, and a month after (in time for devcon4) we should have it on mainnet as well.

## Credits

* @BrendanChou for SafeERC20: https://gist.github.com/BrendanChou/88a2eeb80947ff00bcf58ffdafeaeb61
* @decanus for SignatureValidator
* @ConnextProject for `merkletree.js`
