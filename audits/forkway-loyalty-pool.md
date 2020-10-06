## Scope

The scope of this audit is the two contracts that represent the AdEx Loyalty pool functionality:

* `ADXLoyaltyPoolToken` - an ERC20 compatible contract that's a staking pool - one enters the pool with ADX and it mints the ADX-LOYALTY token
* `ADXLoyaltyPoolIncentiveController` - the contract that implements the so-called elastic issuance

We previously audited the [`ADXToken` contract](https://github.com/AdExNetwork/adex-protocol-eth/blob/master/audits/Forkway_ADXToken_audit.pdf), so it is not part of the scope of this audit.

The `ADXLoyaltyPoolIncentiveController` contract calls into the Chainlink oracle system which has already undergone multiple audits: https://consensys.github.io/blockchainSecurityDB/projects/chainlink/

The initially reviewed commit is 213330ffee64ba20ba9a1ad19e01170b53f847bf

The last reviewed commit is 172615b9f4dc238a6918d1dc3d069087c19e8cd5 which can be found here: https://github.com/AdExNetwork/adex-protocol-eth/blob/172615b9f4dc238a6918d1dc3d069087c19e8cd5/contracts/ADXLoyaltyPool.sol

## Disclaimer

Forkway LTD holds no responsibility for the findings in this security audit. We do not provide any guarantees or warranties related to the function of the smart contract system.


## Summary

The reviewed contracts follow the good practices in software development and in Solidity development. The code is well structured and variable naming is consistent and legible.

All of the issues discovered were resolved before the final mainnet release.


## Process

We will review the loyalty pool system in the following aspects:
* general code quality
* test coverage
* analysis with automated security tools

But most importantly, we'll analyze whether the behavior of the entire system is as intended by the AdEx team.

Here are some constraints we evaluated:

* `ADXLoyaltyPoolToken` implements a single contract that's both the pool and a pool ERC20 token called ADX-LOYALTY
* You can always enter the pool by calling `enter(amount)` with an amount of ADX, unless the `maxTotalADX` limit will be reached after adding the ADX to the pool's balance; this process will issue a pool token that represents your pool share
  * when depositing ADX, this constraint will hold: `amount/(ADX.balanceOf(poolAddr) + amount) = poolTokensIssued/(totalPoolTokens + poolTokensIssued)` or in other words, the pool tokens will be equal to your share of the pool's total ADX
  * when transforming this equation, we get that `poolTokensIssued = amount * totalPoolTokens / ADX.balanceOf(poolAddr)`
* Entering the pool mints a pool token called ADX-LOYALTY that represents your share in the pool; leaving the pool burns it
* ADX cannot be withdrawn from the contract by any other method than burning pool tokens by calling `leave(poolTokenAmount)` or `mintAndLeave(poolTokenAmount)`
* The pool has an incentive parameter set, which is the amount of ADX minted per 365 days per 1 deposited ADX 
* Multiple addresses can be set to govern the contract, where:
  * Each address that has the governance permission can add/remove the governance permission for any other address
  * This includes the ability for a governance address to remove it's own permission, effectively stepping down
  * Each governance address can perform multiple administrative tasks: set the `maxTotalADX` and set the issuance/incentive rate
  * Governance can set the `maxTotalADX` to 0, essentially forbidding entering the pool
* Any ADX sent (transferred) to the contract will be proportionally distributed to stakers
  * It doesn't matter how this ADX is transferred, it doesn't need to be via a smart contract call
* Any entering/leaving the pool will trigger minting of the incentive according to the rate, except `leave(poolTokenAmount)` and `setIncentive(incentivePerTokenPerAnnum)`
  * Since the issuance for a period of time depends on the staked ADX and the rate (`incentivePerTokenPerAnnum`), it needs to be "settled" every time one of those parameters is changed; basically, at every change of `incentivePerTokenPerAnnum` or `ADX.balanceOf(poolAddr)`, the pool mints an additional `incentivePerTokenPerAnnum * ADX.balanceOf(poolAddr) * timeElapsedSinceLastMint` ADX for itself
* `shareValue()` can only increase over time
  * unless `setIncentive()` is called directly by governance (see "`setIncentive` allows governance to manipulate incurred rewards")
* Because there's a maximum of ADX that can be deposited through `enter()` - `maxTotalADX`, the ADX issuance is predictable
* ADX tokens can be sent to the pool contract address directly, which will cause them to be proportionally distributed between pool token (ADX-LOYALTY) holders

The issues discovered are classified using the [OWASP risk rating methodology](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology) for severity.

## Issues

Issues are sorted by severity.

All issues have been resolved by the AdEx team in a timely manner before deploying to mainnet.

There are various by-design peculiarities that could technically affect APY and issuance predictability, but the AdEx team has presented a solid plan to mitigate them.


### ADX deposited can go over the `maxTotalADX`

Since the `enter()` method checks whether the cap is already reached in the beginning, it's possible to enter any amount of ADX in one call. This allows more ADX than the `maxTotalADX` to be deposited.

**Severity:** high

**AdEx team comment:** we will modify the check to ensure that the cap WILL NOT be reached by the end of the `enter()` operation, therefore resolving this problem

**Status:** resolved in commit `b500c725f98f5f3b328c248b7fde2fb4e5bf482e`


### `setIncentive` allows governance to manipulate incurred rewards

`setIncentive` can be used by governance addresses to manipulate unminted rewards in the following ways:

* zero out all of the pending `toMint` incentive that would've been minted in the next `mintIncentive`, which will decrease `shareValue` instantly - this is possible because `setIncentive` essentially resets the accrual period (`lastMintTime`) without an actual mint happening
* [frontrun-sandwich](https://swende.se/blog/Frontrunning.html) each `enter()`, `leave()` and `mintIncentive()` in `setIncentive(0)` and `setIncentive(prevValue)`, therefore making it appear as if the pool is incurring rewards but it's actually not.

A possible solution would be to not reset `lastMintTime` when setting the incentive - in which case, rather than forfeiting the entire `toMint` amount, it would be dynamically changed depending on the value set. This is also a compromise, as it introduces another problem, which is the ability to *increase* `toMint` unexpectedly.

The impact of this is reduced because of the public and transparent nature of the pool - if any of those exploits are applied, ADX-LOYALTY can safely exit the pool without any loss.

Every time one of `enter()`, `leave()` or `mintIncentive()` is called, the incurred reward up until that point is secured and distributed to ADX-LOYALTY holders.

We agree with the AdEx team that this issue is completely mitigated through the use of a timelock, as `mintIncentive()` can be called right before the scheduled execution of `setIncentive()`.

**AdEx team comments:** this can be mitigated very easily by ensuring all governance addresses are either controller contracts with pre-determined abilities, or timelock contracts

**Severity:** medium

**Status:** resolved


### Compounding triggered by auto-minting can cause APY to increase

Each time incentive ADX is minted the ADX balance of the pool increases, which in turn increases the base on which incentive ADX is calculated, which is causing compounding.

This means that the APY is actually slightly higher than the predictable rate, and can be calculated by inversing a natural logarithm, so by `e**rate`.

The min APY is 10% which can compound up to 10.5%, while the max APY is 50%, which can compound up to 64.8%.

**Severity:** low

**AdEx team comment:** while this poses a slight challenge to predicting the issuance, it's still predictable; from a game theory perspective, this is even better for the pool since it incentivizes frequent entering/leaving because it triggers compounding

**Status:** resolved following AdEx team' comment

### Calls to `transferFrom` and `transfer` ignore return values

ERC20 spec defines `transferFrom` and `transfer` as methods that return boolean values. If a transfer is not successful, some tokens revert, while others return$ `false`.

In this case, the contract will be deployed with ADX which always reverts, which means this issue has no impact, but it is strongly recommended to check the return value in case this contract is adapted to work with another token.

**Severity:** low

**AdEx team comment:** noted and fixed

**Status:** resolved in commit 172615b9f4dc238a6918d1dc3d069087c19e8cd5


### Misleading naming of `leave()` and `mintAndLeave()`

We strongly believe that this naming is dangerous for correct usage, since `mintAndLeave()` should always be called unless token minting is impossible (see [Mint failures if the ADX cap is reached](#mint-failures-if-the-adx-cap-is-reached)).

Calling `leave()` in this case will mean you exit the pool without taking all your incurred reward since the last pool entry/leave.

We recommend the functions are renamed to `leave()` for the preferred leave method (currently `mintAndLeave()`), and `leaveEmergency()` for the leave that should be used when minting is impossible.

**Severity:** low

**AdEx team comment:** good point, we renamed the functions

**Status:** resolved, the AdEx team has renamed the functions in commit `1b8f934da815e830e25336678ce5f607c3383831`


### Reaching `maxTotalADX` by sending ADX directly to it can cause ADX to be temporarily stuck

If ADX is sent to the contract directly before any pool tokens are minted, `enter()` will not be callable cause the max has been reached - leading to a situation where these ADX cannot be extracted.

Based on the low likelihood of this happening, this is categorized as low. Furthermore, as pointed out by the AdEx team, this can be solved by setting the `maxTotalADX` higher in order to mint pool tokens.

**AdEx team comment:** This can be worked around by temporarily setting `maxTotalADX` higher, minting pool tokens and using them to reclaim the stuck ADX.

**Severity:** low

**Status:** resolved


### Limited use of event logs

We recommend emitting event logs for critical operations such as setting of governance addresses and setting the incentive rate. This will make it easier to develop off-chain applications that interact with the pool contract.

**AdEx team comment:** noted, logs added in commit 2903d914aa1e89e7ca5a13d39c3a81e220115f23

**Severity:** low

**Status:** resolved


### Issuance can be brought above expected maximum by sending ADX directly to the contract by majority holders

If single party controls an overwhelming majority of the pool shares, they can send ADX directly to the contract to benefit from issuance outside the allowed by `maxTotalADX`- since those tokens will be distributed to pool token holders, in this way they circumvent `maxTotalADX` and trigger higher issuance.

Issuance can be brought back in line with expectations by changing the incentive controller, but this impacts APY predictability.

Another simple fix would be to tweak `toMint()` so that the base it uses to calculate issuance (`totalADX`) is no larger than `maxTotalADX`. This, however, impacts the predictability of the APY, but it discourages this exploit from happening.

This is categorized as "low" as the AdEx team has informed us that they would be staking a significant sum of ADX when the pool is deployed, therefore eliminating the likelihood of this exploit.

**AdEx team comment:** we have decided not to honor the `maxTotalADX` in `toMint()` as suggested because, 1) it impacts the APY predictability 2) it will be unfair to pool token holders who've staked early and then their collective share has incresed over `maxTotalADX`. In this scenario of oversubscription, the pool token will be traded above it's value in ADX.

**Severity:** low

**Status:** resolved


### Mint failures if the ADX cap is reached

If the issuance rate is high, which can happen as a result of setting `maxTotalADX` to a really high value followed by a continuously high amount of ADX in the pool, this can mint enough ADX to reach the supply cal (150M).

However, the likelihood of this happening soon is quite low because the incentive controller can be upgraded by governance addresses and there's a plan in place to do so. 

**Severity:** low

**AdEx team comment:** The incentive controller will be updated to not allow for the cap to be reached. Even if it is, there's still a method to leave the pool and reclaim your ADX even if minting fails

**Status:** resolved


### Unorthodox ability to set symbol

This is the first time we see an ERC20 with an ability to change the `symbol()`. It's not breaking any standards as far as we know but it's unconventional.

**Severity:** informational

**AdEx team comment:** noted, we need this if we come up with a more creative/shorter symbol for the pool token or in case we're forced by soem piece of infrastructure (eg wallet) to make it shorter

**Status:** resolved

### Sending ADX directly to contract can cause higher than expected incentive issuance

Suppose ADX is sent directly to the pool contract. At this point the amount of incentive to be minted will increase as if this amount of ADX has been there the entire time since the last `lastMintTime`. Essentially, ADX sent to the contract will automatically incur interest as if it's been deposited when the last `mintIncentive()` happened (triggered by entering/leaving).

Due to the limitations of the ERC20 standard this can't be resolved better than the AdEx team's solution of having a publically callable `mintIncentive()` function. Any automated system that sends ADX to the pool should call `mintIncentive()` first to avoid this.

**Severity:** informational

**AdEx team comment:** this is why `mintIncentive()` can be called publically - by calling this, the accrued incentive is minted and `lastMintTime` is reset

**Status:** resolved

### `approve()` frontrunning

The ADX-LOYALTY token is vulnerable to the `approve()` frontrunning issue described here: https://github.com/OpenZeppelin/openzeppelin-contracts/issues/599

We agree with AdEx team's santiment that enforcing setting to zero is suboptimal, therefore we consider this resolved.

**Severity:** informational

**AdEx team comment:** solving this on-chain creates more issues than it solves: having to set the approval to zero first creates extra gas costs, and checking whether it's zero before setting it creates extra complexity and is error prone

**Status:** resolved


### No way to arbitrage if `maxTotalADX` is reached

A ADX-LOYALTY/ADX market can be arbitraged through the loyalty contract by exchanging ADX-LOYALTY for ADX or vice versa. However, if there's available liquidity of ADX-LOYALTY/ADX at a higher price than the `shareValue` of the loyalty pool but the `maxTotalADX` is reached, it won't be possible to mint new ADX-LOYALTY.


**Severity:** informational

**AdEx team comment:** acknowledged; because ADX-LOYALTY is essentially a limited supply token that gives you the right to participate in governance, we believe it's fair that it can trade higher than the underlying ADX if the supply has ran out

**Status:** resolved