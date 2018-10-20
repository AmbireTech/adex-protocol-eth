# adex-protocol-eth

The Ethereum implementation of the [AdEx Protocol](https://github.com/AdExNetwork/adex-protocol).

This replaces [adex-core](https://github.com/AdExNetwork/adex-core).

This relies on the concept of an OCEAN, which stands for off-chain event aggregation. Everything that happens in the context of an on-chain commitment will be recorded and aggregated by pre-delegated validators, and submitted on-chain by said validators.

Each validator will be rewarded for voting, and not rewarded if they did not vote.

While OCEAN allows any arbitrary vote value, in this implementation, we consider `0` to mean "Commitment failed" and we return the funds to the advertiser, while anything other than `0` means that it succeeded, and therefore transfer the funds to the publisher.

A vote is only respected if >2/3 of the validators signed on that same vote.

There is a minimum number of validators - 2. Ideally, that will be set to 3, but we need 2 for practical/compatibility reasons with the existing dApp.

### Please note

If >=2/3 signatures are not collected for a commitment, it will time out and be reverted completely. This means that even if some of the validators did vote, they will not get rewarded.

## Deployment

This will be deployed to Ropsten first, and a month after (in time for devcon4) we should have it on mainnet as well.

## Credits

* @BrendanChou for SafeERC20: https://gist.github.com/BrendanChou/88a2eeb80947ff00bcf58ffdafeaeb61
* @decanus for SignatureValidator
