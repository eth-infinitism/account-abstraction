---
eip: 0
title: Account Abstraction Validation Scope Rules
description: A set of limitations on validation EVM code that protects Account Abstraction nodes from exponentially complex computations without compensation
author: Yoav Weiss (@yoavw), Dror Tirosh (@drortirosh), Alex Forshtat (@forshtat), Shahaf Nacson (@shahafn)
discussions-to: https://www.google.com/
status: Draft
type: Standards Track
category: Core
created: 2023-09-01
requires: 6780
---

## Abstract

This document describes the validation rules we impose on the validation context of Account Abstraction transactions,
such as [ERC-4337](./eip-4337) `UserOperation` or [EIP-9999](./eip-9999), which are enforced off-chain by a
block builder or a standalone bundler, and the rationale behind each one of them.

## Motivation

All transactions initiated by EOAs have an implicit validation phase where balance, nonce, and signature are
checked to be valid for the current state of the Ethereum blockchain.
Once the transaction is checked to be valid by a node, only then another transaction by the same EOA can modify the Ethereum
state in a way that makes the first transaction invalid.

With Account Abstraction, however, the validation can also include an arbitrary EVM code and rely on storage as well,
which means that unrelated `UserOperations` or transactions may invalidate each other.

If not addressed, this would make the job of maintaining a mempool of valid `UserOperations` and producing valid
bundles computationally infeasible and susceptible to DoS attacks.

This document describes a set of validation rules that, if applied by a bundler before accepting a `UserOperation`
into the mempool can prevent such attacks.

## Specification

### Definition of the `mass invalidation attack`

A possible set of actions is considered to be a `mass invalidation attack` on the network if a large number of
`UserOperations` that did pass the initial validation and were accepted by nodes and propagated further into the
mempool to all bundlers in the network, becomes invalid and not eligible for inclusion in a block.

There are 3 ways to perform such an attack:

1. Create a `UserOperation` that passes the initial validation, but later fails the re-validation
   that is performed during the bundle creation.
2. Submit `UserOperation`s that are valid in isolation during validation, but when bundled together become invalid.
3. Submit valid `UserOperation`s but "front-run" them by executing a state change on the
   network that causes them to become invalid. The "front-run" in question must be economically viable.

To prevent such attacks, we attempt to "sandbox" the validation code.
We isolate the validation code from other `UserOperations`, from external changes to the storage, and
from information about the environment such as a current block timestamp.

### What is not considered a `mass invalidation attack`

A `UserOperation` that fails the initial validation by a receiving node without entering its mempool is not
considered an attack. The node is expected to apply web2 security measures and throttle requests based on API key,
source IP address, etc.
RPC nodes already do that to prevent being spammed with invalid transactions which also have a validation cost.

### Constants:


| Title                                | Value                       | Comment                                                                         |
|--------------------------------------|-----------------------------|---------------------------------------------------------------------------------|
| `MIN_UNSTAKE_DELAY`                  | 86400                       | 1 day                                                                           |
| `MIN_STAKE_VALUE`                    | Adjustable per chain value  | Equivalent to ~$1000 in native tokens                                           |
| `SAME_SENDER_MEMPOOL_COUNT`          | 4                           |                                                                                 |
| `SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT` | 10                          |                                                                                 |
| `THROTTLED_ENTITY_MEMPOOL_COUNT`     | 4                           | Number of `UserOperations` with a throttled entity that can stay in the mempool |
| `THROTTLED_ENTITY_LIVE_BLOCKS`       | 10                          | Number of blocks a `UserOperations` with a throttled entity can stay in mempool |
| `THROTTLED_ENTITY_BUNDLE_COUNT`      | 4                           |                                                                                 |
| `MIN_INCLUSION_RATE_DENOMINATOR`     | 100 (client) \ 10 (bundler) |                                                                                 |
| `INCLUSION_RATE_FACTOR`              | 10                          |                                                                                 |
| `THROTTLING_SLACK`                   | 10                          |                                                                                 |
| `BAN_SLACK`                          | 50                          |                                                                                 |

### Validation Rules

### **Definitions**:
1. **Validation Phases**: there are up to 3 phases of validation
   1. smart account deployment
   2. smart account validation 
   3. paymaster validation.
2. **Entity**: a contract that is explicitly used by the `UserOperation`.
   Includes the `factory`, `paymaster`, `aggregator` and staked `account`, as discussed below. \
   Each "validation phase" is attributed to a single entity. \
   Entity contracts must have non-empty code on-chain.
3. **Canonical Mempool**: The rules defined in this document apply to the main mempool shared by all bundlers on the network.
4. **Staked Entity:** an entity that has a locked stake of at least `MIN_STAKE_VALUE`
   and an unstake delay of at least `MIN_UNSTAKE_DELAY`.
5. **Associated storage:** a storage slot of any smart contract is considered to be "associated" with address `A` if:
    1. The slot value is `A`
    2. The slot value was calculated as `keccak(A||x)+n`, where `x` is a `bytes32` value, and `n` is a value in the range 0..128
6. **Using an address**: accessing the code of a given address in any way.
   This can be done by executing `*CALL` or `EXTCODE*` opcodes for a given address.

### Reputation Definitions:
1. **opsSeen**: a per-entity counter of how many times a unique valid `UserOperation` referencing this entity
   was received by this bundler.
   This includes `UserOperation` received via an incoming RPC calls or through a P2P mempool protocol.
   * For a `paymaster`, this value is not incremented if factory or account validation fails.    

2. **opsIncluded**: a per-entity counter of how many times a unique valid `UserOperation` referencing this entity
   appeared in an actual included `UserOperation`. \
   Calculation of this value is based on UserOperationEvents and is only counted for `UserOperations` that were
   previously counted as `opsSeen` by this bundler.
3. Both values are updated every hour as `value = value * 23 // 24` \
   Effectively, the value is reduced to 1% after 4 days.
4. **inclusionRate**: Relation of `opsIncluded`  to `opsSeen`


### Reputation calculation

We define a value `max_seen = opsSeen // MIN_INCLUSION_RATE_DENOMINATOR`.

The reputation state of each entity is determined as follows:

1. **BANNED**: `max_seen > opsIncluded + BAN_SLACK`
2. **THROTTLED**: `max_seen > opsIncluded + THROTTLING_SLACK`
3. **OK**: otherwise

Note that new entities start with an `OK` reputation.

To help make sense of these params, note that a malicious paymaster can at most cause the network (only the p2p network, not the blockchain) to process `BAN_SLACK * MIN_INCLUSION_RATE_DENOMINATOR / 24` non-paying ops per hour.

### Running the Validation Rules

1. A block builder or a bundler should perform a full validation before accepting a `UserOperation` into its mempool.
2. During validation phase, the bundler should trace the execution and apply all the rules defined in this document.
3. A bundler should also perform a full validation of the entire bundle before submission.
4. The validation rules prevent an unstaked entity from detecting the bundle validation.
   However, it is possible for a malicious staked entity to detect the bundle validation and cause a revert.
5. The failed `UserOperation` should be dropped from the bundle.
6. The staked entity that caused a revert violated the Account Abstraction rules and should be marked as `THROTTLED`.

### Mempool Validation Rules

1. A `UserOperation` is broadcast over the P2P protocol with the following information:
    1. The `UserOperation` itself
    2. The blockhash this `UserOperation` was originally verified against.
2. Once a `UserOperation` is received from another bundler it should be verified locally by a receiving bundler.
3. A received `UserOperation` may fail any of the reasonable static checks, such as: \
   invalid format, values below minimum, submitted with a blockhash that isn't recent, etc. \
   In this case the bundler should drop this particular `UserOperation` but keep the connection.
4. The bundler should validate the `UserOperation` against the nonces of last-included bundles. \
   Silently drop `UserOperations` with `nonce` that was recently included.
   This invalidation is likely attributable to a network racing condition and should not cause a reputation change.
5. If a received `UserOperation` fails against the current block:
    1. Retry the validation against the block the `UserOperation` was originally verified against.
    2. If it succeeds, silently drop the `UserOperation` and keep the connection.
    3. If it fails, mark the sender as a "spammer"

### Opcode Rules
* Block access from opcodes that access information outside of storage and code (aka "environment").
    * **[OP-011]** Blocked Opcodes:
        * `BALANCE` (`0x31`)
        * `ORIGIN` (`0x32`)
        * `GASPRICE` (`0x3A`)
        * `BLOCKHASH` (`0x40`)
        * `COINBASE` (`0x41`)
        * `TIMESTAMP` (`0x42`)
        * `NUMBER` (`0x43`)
        * `PREVRANDAO`/`DIFFICULTY` (`0x44`)
        * `GASLIMIT` (`0x45`)
        * `SELFBALANCE` (`0x47`)
        * `BASEFEE` (`0x48`)
        * `GAS` (`0x5A`)
        * `CREATE` (`0xF0`)
        * `INVALID` (`0xFE`)
        * `SELFDESTRUCT` (`0xFF`)
    * **[OP-012]** `GAS `opcode is allowed, but only if followed immediately by `*CALL` instructions.\
      This is a common way to pass all remaining gas to an external call, and it means that the actual value is
      consumed from the stack immediately and cannot be accessed by any other opcode.
    * **[OP-13]** any "unassigned" opcode.
* **[OP-020]** Revert on "out of gas" is forbidden as it can "leak" the gas limit or the current call stack depth.
* Contract creation:
    * **[OP-031]** `CREATE2` is allowed exactly once in the deployment phase and must deploy code for the "sender" address.
* Access to an address without a deployed code is forbidden:
    * **[OP-041]** For `EXTCODE*` and `*CALL` opcodes
    * **[OP-042]** Exception: access to "sender" address is allowed.
      This is only possible in `factory` code during the deployment phase.
* Allowed access to the `EntryPoint` address:
    * **[OP-051]** May call `EXTCODESIZE ISZERO`\
      This pattern is used to check destination has code before `depositTo` function is called.
    * **[OP-052]** May call `depositTo(sender)` with any value from either the `sender` or `factory`
    * **[OP-053]** May call the fallback function from the `sender` with any value
    * **[OP-054]** Any other access to the `EntryPoint` is forbidden
* `*CALL` opcodes:
    * **[OP-061]** `CALL` with `value` is forbidden. The only exception is a call to the `EntryPoint` described above.
    * **[OP-062]** Precompiles:
        * Only allowed the core 9 precompiles.\
          Specifically the computation precompiles that do not access anything in the blockchain state or environment.

### Code Rules

* **[COD-010]** Between the first and the second validations, the `EXTCODEHASH` value of any visited address,
entity or referenced library, may not be changed.\
If the code is modified, the UserOperation is considered invalid.

### Storage rules.

The permanent storage access with `SLOAD` and `SSTORE` instructions within each phase are limited as follows:

* **[STO-010]** Access to the "account" storage is always allowed.
* Access to associated storage of the account in an external (non-entity contract) is allowed if either:
    * **[STO-021]**  The account already exists
    * **[STO-022]**  There is an `initCode` and the `factory` contract is staked.
* If the entity (`paymaster`, `factory`) is staked, then it is also allowed:
    * **[STO-031]** Access the entity's own storage.
    * **[STO-032]** Read/Write Access to storage slots that is associated with the entity, in any non-entity contract.
    * **[STO-033]** Read-only access to any storage in non-entity contract.
* **[STO-040]** `UserOperation` may not use an entity address (`factory`/`paymaster`/`aggregator`) that is used as an "account" in another `UserOperation` in the mempool. \
This means that a `Paymaster` and `Factory` contracts cannot practically be an "account" contract as well.
* **[STO-041]** A contract whose Associated Storage slot is accessed during a `UserOperation` may not be an address of a "sender" in another `UserOperation` in the mempool.

### Staked Entities Reputation Rules

* **[SREP-010]** The "canonical mempool" defines a staked entity if it has `MIN_STAKE_VALUE` and unstake delay of `MIN_UNSTAKE_DELAY`
* **[SREP-020]** A `BANNED` address is not allowed into the mempool.\
  Also, all existing `UserOperations` referencing this address are removed from the mempool.
* **[SREP-030]** A `THROTTLED` address is limited to:
    * `THROTTLED_ENTITY_MEMPOOL_COUNT` entries in the mempool.
    * `THROTTLED_ENTITY_BUNDLE_COUNT` `UserOperations` in a bundle.
    * Can remain in the mempool only for `THROTTLED_ENTITY_LIVE_BLOCKS`.
* **[SREP-040]** An `OK` staked entity is unlimited by the reputation rule.
    * Allowed in unlimited numbers in the mempool.
    * Allowed in unlimited numbers in a bundle.
* **[SREP-050]** If a staked entity fails the second validation or fails bundle creation, its `opsSeen` is incremented by `10000`, causing it to be `BANNED`.

### Entity-specific rules:

* **[EREP-010]** For each `paymaster`, the mempool must maintain the total gas `UserOperations` using this `paymaster` may consume.
    * Do not add a `UserOperation` to the mempool if the maximum total gas usage, including the new `UserOperation`, is above the deposit of the `paymaster` at the current gas price.
    * TODO: allow "fractional reserve" based on reputation?
* **[EREP-020]** A staked factory is "accountable" for account breaking the rules. \
That is, if the `validateUserOp()` is rejected for any reason, it is treated as if the factory caused this failure, and thus this affects its reputation.
* **[EREP-030]** A Staked Account is accountable for failures in other entities (`paymaster`, `aggregator`) even if they are staked. \
(see [https://github.com/eth-infinitism/account-abstraction/issues/274](https://github.com/eth-infinitism/account-abstraction/issues/274))
* **[EREP-040]** An `aggregator` must be staked, regardless of storage usage.
* **[EREP-050]** An unstaked `paymaster` may not return a `context`.
    * TODO: can be removed once we remove the "2nd postOp".

### Unstaked Entities Reputation Rules

* Definitions:
    * **`opsSeen`, `opsIncluded`, and reputation calculation** are defined above.
    * `UnstakedReputation` of an entity is a maximum number of entries using this entity allowed in the mempool.
    * `opsAllowed` is a reputation based calculation for an unstaked entity, representing how many `UserOperations` it is allowed to have in the mempool.
* **[UREP-010]** `UserOperation` with unstaked sender are only allowed up to `SAME_SENDER_MEMPOOL_COUNT` times in the mempool.
* **[UREP-020]** For other entities: \
    `opsAllowed = SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT + (inclusionRate * INCLUSION_RATE_FACTOR) + (min(opsIncluded, 10000)`.
    * This is a default of `SAME_UNSTAKED_ENTITY_MEMPOOL_COUNT` for new entity
* **[UREP-030]** If an unstaked entity causes an invalidation of a bundle, its `opsSeen` is set to `1000`, effectively blocking it from inclusion for 24 hours.

### Alt-mempools rules:

Alternate mempool is an agreed-upon rule that the bundlers may opt in to.

* **[ALT-010]** The bundler listens to the alt-mempool "topic" over the P2P protocol
* **[ALT-020]** The alt mempool rules MUST be checked only when a canonical rule is violated
    * That is, if validation follows the canonical rules above, it is not considered part of an alt-mempool.
* **[ALT-030]** Bundlers SHOULD forward `UserOperations` to other bundlers only once, regardless of how many (shared) alt-mempools they have. \
The receiving bundler validates the `UserOperations`, and based on the above rules (and subscribed alt-mempools) decides for which alt-mempools to "tag" it.


## Security Considerations

### Possible Attacks

Below is a list of possible attacks that were considered and a reference to the above rule that prevents it.

This list does not attempt to be an exhaustive list of attacks.
These attacks are examples provided to describe and rationalise the reason for the above rules.

#### Sample Known (expensive) attack:

* This attack can't be fully mitigated by the above validation rules.
  But the rules made sure it is expensive to maintain.
* Deploy a paymaster which has the following line in the validation function: \
`require((perSenderMap[userOp.sender]&1)==0);`
* Submit a large number of `UserOperations` with different senders into the mempool.
* Front-run the mempool, and modify the `perSenderMap` for each sender.
* By the time the `UserOperations` are validated the second time they are all invalid.
* The cost of first run is 20000 gas per account, but the second run is 5000 gas per account.
* NOTE: Because of the rule **[STO-021]** "forbid associated storage during creation", the accounts have to be pre-deployed. This introduces a one-time cost of ~40000 gas per account.
* Calculate the cost of blocking the network:
* Assuming a bundler can process 1000 `UserOperations`/second
* Polygon - (2-second blocks) need 2000 `UserOperations`
    * The initial cost (deploy+initial state change) is 2000*60000 = 120M gas
    * Sustained cost (only storage modification) - 2000*5000 =  10M gas
* Mainnet- (12-second blocks) need 12000 UserOps
    * The initial cost (deploy+initial state change) is 12000*60000 = 720M gas
    * Sustained cost (only storage modification) - 12000*5000 =  70Mgas
* Total attack cost
    * Polygon (@150 gwei) - $18 + $1.5 per block ($2700/hour)
    * Mainnet: (@40 gwei) - $51840 + $5040 per block ($1.5M/hour)
    * Note that the above costs ignore the gas-price increase because the underlying network is also overloaded.
* Mitigations
    * A **staked factory:** 
        * Can attempt such an attack once, since after invalidating a single bundle creation its reputation drops and another staked factory has to be used.
        * So a successful attack needs to deploy and stake a new paymaster on every block. The old paymaster's stake is locked and can be re-used only after 24 hours.
    * For **unstaked factory**:
        * As per **[UREP-020]**, it is initially allowed only 10 `UserOperations` in the mempool.
        * That value increases fast, but drops (to negative) on invalidations.
        * It needs to successfully deploy 10 `UserOperations` to get a reputation to deploy a batch of 1000 (which attack).
        * After a single "attack", its reputation is dropped, and it gets banned for a day, so another factory needs to be deployed.
        * So the cost of the attack is 10 actual deployments for 1000 failures.

#### List of attacks:

1. **Use volatile data**\
Send a large number of `UserOperations` with `initCode` to deploy an account with a validation that contains `require((block.number&1)==0)` into the mempool.\
They all get invalidated at no cost to the sender when tried to be included in the next block. \
**Blocked by: [OP-011]** "opcode banning" rule.
2. **Use uninitialized code**\
The validation function includes the code: `tempaddr.call(..);` and execution does `new {salt}()` where the tempaddr is
initialized to the address returned by the `new`.\
This code passes validation since the generated contract does not exist, but other `UserOperations` with the same code
will revert since the target is already created, and revert on this calldata.\
**Blocked by: [OP-041]** "reference uninitialized code" rule.
3. **Use inner contact creation**\
The validation function includes the code: `require(new {salt:0}SomeContract() !=0)`\
When submitting multiple such `UserOperations`, all pass the validation and enter the mempool, and even pass the second validation.\
But when creating a bundle, the first one will succeed and the rest will revert. \
**Blocked by: **[OP-031]** "`CREATE`/`CREATE2` is blocked"**
4. **Censorship attack**\
`UserOperation` sender can access associated storage in another `UserOperation` sender that is
supposed to be in the bundle (e.g. `anotherSender.balanceOf(this)`), provide a higher gas price than the other sender,
effectively censoring the other sender.
    1. Assumes the attacked account has a method `getData(xx)`, where `xx` can be set to `this`.
       Many account do have such a method, e.g. `ERC721Y` have generic `getData` method.
    2. By rule **[STO-041]**, senders cannot access each other's storage, making bundlers choose only one
       `UserOperation` between those, probably the more profitable one.
       Currently, the bundlers have no incentive to prevent such censorship attacks.
    3. Mitigation:
        1. First, the sender of the censored `UserOperation` needs to detect such attacks,
           and the only mitigation at the moment is to bump the gas price of the censored `UserOperation`.
        2. There should be at least one "proper" bundler in the network, that follows rule [STO-041],
           and prefers the sender over the other `UserOperation` which attempts to censor it.
