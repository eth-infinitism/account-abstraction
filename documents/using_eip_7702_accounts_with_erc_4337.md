# Using [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702) accounts with [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)

## Introduction

EIP-7702 opens a new way for ethereum users to use their account. It allows accounts to act like contracts, and execute on-chain code. This document describes how such accounts can leverage the ERC-4337 infrastructure, and use paymasters to pay for their transaction.
This document describes:

-  The needed modification to the RPC calls
-  Code modifications to the bundler
-  Updated validation rules, to support the new contract types
-  Suggested account types that leverage eip-7702

## Motivation

By itself EIP-7702 lets an account to have a code in its account, and thus let it run an arbitrary set of actions, instead of only one. It also allows separating the execution and gas payment. However, it requires an infrastructure of services that agree to pay for such transactions.
ERC-4337 is such a framework, with a thriving ecosystem of bundlers, paymasters and accounts.
EIP-7702 accounts are natural fit to use this framework, with minimal adaptations to the bundlers - and no modifications to paymaster contracts.

## Required modification to the RPC

The main ERC-4337 RPC call is eth_sendUserOperation, which takes a UserOperation structure. In order to support EIP-7702, we add a new json element named `eip7702Auth`, to hold the eip-7702 auth tuple items. The recovered address MUST be the sender of this UserOperation.

### Example:

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "eth_sendUserOperation",
    "params": [
        {
            "eip7702Auth": {
                "chainId": "chainId",
                "nonce": "nonce",
                "address": "address",
                "r": "r",
                "s": "s",
                "yParity": "yParity"
            },
            "sender": "sender", // address
            "...": "..." // all other userop params
        },
        "entryPoint" // address
    ]
}
```

NOTE: With used with `estimateUserOperation`, the signature is not checked, and the UserOperation is processed as if the signature is valid.

## Modification On the usage of UserOperation

The `initCode` in a UserOperation which is used to initialize an account can't be use as-is with EIP-7702 accounts. Those accounts are not created using a constructor call, but "already exist" when the transaction executes. So any initialization code has to be done on an already-created account.

Also, since the `eip7702tuple` cannot be checked directly by the protocol (EntryPoint), we have to make sure the bundler is required to incorporate this tuple into the transaction. This is done by making sure the current "delegate" is part of the userOpHash.

So for EIP-7702 accounts, we add the following logic to the EntryPoint:

1.  Check if the `initCode` starts with `"0x7702"`. If it doesn't, then treat the UserOperation as normal (that is, if `initCode` exists, use it to deploy the SCA using a factory. If `initCode` is empty, then account is already installed, either with EIP-7702 account or normal SCA).

2.  If the `initCode` starts with `"0x7702"`, then the account MUST be an EIP-7702 account, deployed either by this transaction or some previous transaction.

3.  For the purpose of creating the UserOpHash, replace the first 20 bytes of the `initCode` with the account's delegate. Note that the delegate itself doesn't appear in the UserOp or the transaction's callData, but it is included in the hash.

4.  Since the userOpHash is calculated now over an ERC-712 structure, that structure should include the delegate, as part of the `initCode`, instead of the above `"0xEF0100"` marker.

5.  If the total length of the `initCode` exceeds 20 bytes (starting with the `"0xEF0100"` prefix, followed by all zeros), then use it to call the account itself. (that is, just like a factory, but calling the account itself)

Note that this change required `EXTCODECOPY` to return the full code (3-byte prefix+delegate address) of the account.

Is it possible to work without this change?

-  Accounts are not "required" to use the above method: they can use UserOperations as they are today.

-  The first UserOperation can simply work (obviously, it depends on the `eip7702tuple` it includes, because `validateUserOp` can't succeed unless the account is deployed). It does require initialization through the `validateUserOp`. 

-  Subsequent UserOperation that try to modify the delegate (by including another `eip7702tuple`), require special handling to detect if the delegate was included. This is because bundlers are actually "incentivised" to cheat and remove the new delegate: the account pre-paid for it, so if the validation doesn't check the delegate change, then the bundler can "pocket" this value, regardless if the execution reverts.

-  We thought of several workarounds to validate the delegate, with a modification to the account code and signature check (e.g. [here](https://gist.github.com/drortirosh/b65f726098bf122354d568647cb874c1#file-eip7702account-sol-L42)), but we believe it is error-prone, awkward, and doesn't provide a full solution.

## Modification to the P2P protocol

For the UserOpertaion struct defined in [p2p-interface](https://github.com/eth-infinitism/bundler-spec/blob/main/p2p-specs/p2p-interface.md#userop) we add a new `eip7702auth` field, which is an array of the `{ chain,nonce,address,r,s,v }` tuple. The array has a size of either 0 or 1.

## Modifications required to the Bundler

When receiving a UserOperation (either for eth_sendUserOperation, or for eth_estimateUserOperation), the bundler should check the eip-7702 signature, and drop the `eip7702auth` entry if it doesn't match the sender's address (it MAY still process the userop itself, without the `eip7702auth` entry, but it would probably fail).

If the same sender already exists in the list of pending UserOps, and contains a delegate, it MUST have the same delegate.
Before doing the "validation simulation call", the bundler should also check the current account's nonce, and drop the authList item if the nonce was changed. When performing the tracing, the bundler should use `stateOverride`, to "inject" the delegate, E.g adding `{ "stateOverrides": { userOp.sender: "0xef0100"+ userOp.eip7702auth.address } }` 
When creating the bundle (a "handleOps" call), the bundler should collect all authList items to the created transaction.

## Added validation rule for ERC-7562

Eip-7702 account has code, but it is modifiable by the account itself.  As such, it is treated just like storage of the account - much like the "proxyTarget" address used in a normal proxy.

[AUTH-001]:  An EIP-7702 delegate can only be used as a "sender". It cannot be used as another entity.

[AUTH-002]: A call to EIP-7702 delegate is only allowed to the "sender" address, and not to any other address.

## Rationale

The validation rules on storage prevent modification of storage that will affect a large number of UserOperations.
A "delegate" is modifiable by its account, and thus can be treated like a storage of that account. Moreover, it is an "exec-only" storage (can't read its value), and thus it has to be forbidden from access even by staked entities.
