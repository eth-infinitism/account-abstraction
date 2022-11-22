// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "../interfaces/IWallet.sol";
import "../interfaces/IEntryPoint.sol";

/**
 * Basic wallet implementation.
 * this contract provides the basic logic for implementing the IWallet interface  - validateUserOp
 * specific wallet implementation should inherit it and provide the wallet-specific logic
 */
abstract contract BaseWallet is IWallet {
    using UserOperationLib for UserOperation;

    /**
     * return the wallet nonce.
     * subclass should return a nonce value that is used both by _validateAndUpdateNonce, and by the external provider (to read the current nonce)
     */
    function nonce() public view virtual returns (uint256);

    /**
     * return the entryPoint used by this wallet.
     * subclass should return the current entryPoint used by this wallet.
     */
    function entryPoint() public view virtual returns (IEntryPoint);

    /**
     * Validate user's signature and nonce.
     * subclass doesn't need to override this method. Instead, it should override the specific internal validation methods.
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 userOpHash, address aggregator, uint256 missingWalletFunds)
    external override virtual returns (uint256 deadline) {
        _requireFromEntryPoint();
        deadline = _validateSignature(userOp, userOpHash, aggregator);
        if (userOp.initCode.length == 0) {
            _validateAndUpdateNonce(userOp);
        }
        _payPrefund(missingWalletFunds);
    }

    /**
     * ensure the request comes from the known entrypoint.
     */
    function _requireFromEntryPoint() internal virtual view {
        require(msg.sender == address(entryPoint()), "wallet: not from EntryPoint");
    }

    /**
     * validate the signature is valid for this message.
     * @param userOp validate the userOp.signature field
     * @param userOpHash convenient field: the hash of the request, to check the signature against
     *          (also hashes the entrypoint and chain-id)
     * @param aggregator the current aggregator. can be ignored by wallets that don't use aggregators
     * @return deadline the last block timestamp this operation is valid, or zero if it is valid indefinitely.
     *      Note that the validation code cannot use block.timestamp (or block.number) directly.
     */
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address aggregator)
    internal virtual returns (uint256 deadline);

    /**
     * validate the current nonce matches the UserOperation nonce.
     * then it should update the wallet's state to prevent replay of this UserOperation.
     * called only if initCode is empty (since "nonce" field is used as "salt" on wallet creation)
     * @param userOp the op to validate.
     */
    function _validateAndUpdateNonce(UserOperation calldata userOp) internal virtual;

    /**
     * sends to the entrypoint (msg.sender) the missing funds for this transaction.
     * subclass MAY override this method for better funds management
     * (e.g. send to the entryPoint more than the minimum required, so that in future transactions
     * it will not be required to send again)
     * @param missingWalletFunds the minimum value this method should send the entrypoint.
     *  this value MAY be zero, in case there is enough deposit, or the userOp has a paymaster.
     */
    function _payPrefund(uint256 missingWalletFunds) internal virtual {
        if (missingWalletFunds != 0) {
            (bool success,) = payable(msg.sender).call{value : missingWalletFunds, gas : type(uint256).max}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }

    /**
     * expose an api to modify the entryPoint.
     * must be called by current "admin" of the wallet.
     * @param newEntryPoint the new entrypoint to trust.
     */
    function updateEntryPoint(address newEntryPoint) external {
        _requireFromAdmin();
        _updateEntryPoint(newEntryPoint);
    }

    /**
     * ensure the caller is allowed "admin" operations (such as changing the entryPoint)
     * default implementation trust the wallet itself (or any signer that passes "validateUserOp")
     * to be the "admin"
     */
    function _requireFromAdmin() internal view virtual {
        require(msg.sender == address(this) || msg.sender == address(entryPoint()), "not admin");
    }

    /**
     * update the current entrypoint.
     * subclass should override and update current entrypoint
     */
    function _updateEntryPoint(address) internal virtual;
}
