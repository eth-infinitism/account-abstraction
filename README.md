# Description

This repository contains the tools and resources for working with [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) Account Abstraction smart contracts. This includes the code for the singleton `EntryPoint` contract that is deployed by our team on most EVM-compatible networks.

# Overview

Account abstraction allows users to interact with Ethereum using smart contract wallets instead of EOAs, without compromising decentralization, providing benefits like:

- Social recovery
- Batched transactions
- Sponsored transactions (gas abstraction)
- Signature abstraction
- Advanced authorization logic

# Repository Structure 

## Core Components

- **EntryPoint Contract** (`contracts/core/EntryPoint.sol`): The central contract that processes UserOperations
- **BaseAccount** (`contracts/core/BaseAccount.sol`): Base implementation for smart contract accounts
- **BasePaymaster** (`contracts/core/BasePaymaster.sol`): Helper class for creating a paymaster
- **StakeManager** (`contracts/core/StakeManager.sol`): Manages deposits and stakes for accounts and paymasters
- **NonceManager** (`contracts/core/NonceManager.sol`): Handles nonce management for accounts
- **UserOperationLib** (`contracts/core/UserOperationLib.sol`): Utilities for working with UserOperations
- **Helpers** (`contracts/core/Helpers.sol`): Common constants and helper functions


## Sample Implementations

- **SimpleAccount** (`contracts/accounts/SimpleAccount.sol`): Basic implementation of an ERC-4337 account

- **Simple7702Account** (`contracts/accounts/Simple7702Account.sol`): A minimal account to be used with EIP-7702 (for batching) and ERC-4337 (for gas sponsoring)

- **SimpleAccountFactory** (`contracts/accounts/SimpleAccountFactory.sol`): A sample factory contract for SimpleAccount


# Developer setup

## Installation 

### Clone the repository:

````bash
git clone https://github.com/eth-infinitism/account-abstraction.git
cd account-abstraction
yarn install
yarn install --registry=https://registry.npmmirror.com
````
### Compilation:

```bash
yarn compile
```

### Testing:

```bash
yarn test
``` 
	

## Entrypoint Deployment

The EntryPoint contract is the central hub for processing UserOperations. It:
- Validates UserOperations
- Handles account creation (if needed)
- Executes the requested operations
- Manages gas payments and refunds

The EntryPoint is deployed by using 

```bash
hardhat deploy --network {net}
```

[EntryPoint v0.8](https://github.com/eth-infinitism/account-abstraction/releases/latest) is always deployed at address `0x4337084d9e255ff0702461cf8895ce9e3b5ff108`

This repository also includes a number of audited base classes and utilities that can simplify the development of AA related contracts.

## Usage
### For projects integrating the library 

If you are building a project that uses account abstraction and want to integrate our contracts:

```bash
yarn add @account-abstraction/contracts
```

### For Paymaster development

```solidity
import "@account-abstraction/contracts/core/BasePaymaster.sol";

contract MyCustomPaymaster is BasePaymaster {
    /// implement your gas payment logic here
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) internal virtual override returns (bytes memory context, uint256 validationData) {
        context = “”; // specify “context” if needed in postOp call. 
        validationData = _packValidationData(
            false,
            validUntil,
            validAfter
        );
    }
}

```



### For Smart Contract Account development

```bash
import "@account-abstraction/contracts/core/BaseAccount.sol";

contract MyAccount is BaseAccount {

    /// implement your authentication logic here
    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
    internal override virtual returns (uint256 validationData) {

        // UserOpHash can be generated using eth_signTypedData_v4
        if (owner != ECDSA.recover(userOpHash, userOp.signature))
            return SIG_VALIDATION_FAILED;
        return SIG_VALIDATION_SUCCESS;
    }
}
```

# Resources

- [Homepage](https://www.erc4337.io/)
- [Blog](https://erc4337.mirror.xyz/)
- [X Account](https://x.com/erc4337)
- [YouTube Channel](https://www.youtube.com/@ERC-4337)
- [Bundlebear](https://www.bundlebear.com/overview/all)
- [Vitalik Buterin - a history of account abstraction](https://www.youtube.com/watch?v=iLf8qpOmxQc)
- [Beyond 4337: Vitalik Buterin's Vision for the Future of Account Abstraction](https://www.youtube.com/watch?v=zpqa1Z4UpiA)
- [Exploring the Future of Account Abstraction by Yoav Weiss](https://www.youtube.com/watch?v=63Wd5mPla-M)
- [Native Account Abstraction in Pectra, rollups and beyond](https://www.youtube.com/watch?v=FYanFF-yU6w)
- [Vitalik Buterin - account abstraction without Ethereum protocol changes](https://medium.com/infinitism/erc-4337-account-abstraction-without-ethereum-protocol-changes-d75c9d94dc4a)
- [Unified ERC-4337 mempool](https://notes.ethereum.org/@yoav/unified-erc-4337-mempool)
- [Bundler reference implementation](https://github.com/eth-infinitism/bundler)
- [Discord server](http://discord.gg/fbDyENb6Y9)
