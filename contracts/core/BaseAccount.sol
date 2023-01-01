// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "../interfaces/IAccount.sol";
import "../interfaces/IEntryPoint.sol";

/**
 * Basic account implementation.
 * this contract provides the basic logic for implementing the IAccount interface  - validateUserOp
 * specific account implementation should inherit it and provide the account-specific logic
 */
abstract contract BaseAccount is IAccount {
    using UserOperationLib for UserOperation;

    //return value in case of signature failure, with no time-range.
    // equivalent to packSigTimeRange(true,0,0);
    uint256 constant internal SIG_VALIDATION_FAILED = 1;

    /**
     * helper to pack the return value for validateUserOp
     * @param sigFailed true if the signature check failed, false, if it succeeded.
     * @param validUntil last timestamp this UserOperation is valid (or zero for infinite)
     * @param validAfter first timestamp this UserOperation is valid
     */
    function packSigTimeRange(bool sigFailed, uint256 validUntil, uint256 validAfter) internal pure returns (uint256) {
        return uint256(sigFailed ? 1 : 0) | uint256(validUntil << 8) | uint256(validAfter << (64+8));
    }

    /**
     * return the account nonce.
     * subclass should return a nonce value that is used both by _validateAndUpdateNonce, and by the external provider (to read the current nonce)
     */
    function nonce() public view virtual returns (uint256);

    /**
     * return the entryPoint used by this account.
     * subclass should return the current entryPoint used by this account.
     */
    function entryPoint() public view virtual returns (IEntryPoint);

    /**
     * Validate user's signature and nonce.
     * subclass doesn't need to override this method. Instead, it should override the specific internal validation methods.
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 userOpHash, address aggregator, uint256 missingAccountFunds)
    external override virtual returns (uint256 sigTimeRange) {
        _requireFromEntryPoint();
        sigTimeRange = _validateSignature(userOp, userOpHash, aggregator);
        if (userOp.initCode.length == 0) {
            _validateAndUpdateNonce(userOp);
        }
        _payPrefund(missingAccountFunds);
    }

    /**
     * ensure the request comes from the known entrypoint.
     */
    function _requireFromEntryPoint() internal virtual view {
        require(msg.sender == address(entryPoint()), "account: not from EntryPoint");
    }

    /**
     * validate the signature is valid for this message.
     * @param userOp validate the userOp.signature field
     * @param userOpHash convenient field: the hash of the request, to check the signature against
     *          (also hashes the entrypoint and chain-id)
     * @param aggregator the current aggregator. can be ignored by accounts that don't use aggregators
     * @return sigTimeRange signature and time-range of this operation
     *      <byte> sigFailure - (1) to mark signature failure, 0 for valid signature.
     *      <8-byte> validUntil - last timestamp this operation is valid. 0 for "indefinite"
     *      <8-byte> validAfter - first timestamp this operation is valid
     *      The an account doesn't use time-range, it is enough to return SIG_VALIDATION_FAILED value (1) for signature failure.
     *      Note that the validation code cannot use block.timestamp (or block.number) directly.
     */
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address aggregator)
    internal virtual returns (uint256 sigTimeRange);

    /**
     * validate the current nonce matches the UserOperation nonce.
     * then it should update the account's state to prevent replay of this UserOperation.
     * called only if initCode is empty (since "nonce" field is used as "salt" on account creation)
     * @param userOp the op to validate.
     */
    function _validateAndUpdateNonce(UserOperation calldata userOp) internal virtual;

    /**
     * sends to the entrypoint (msg.sender) the missing funds for this transaction.
     * subclass MAY override this method for better funds management
     * (e.g. send to the entryPoint more than the minimum required, so that in future transactions
     * it will not be required to send again)
     * @param missingAccountFunds the minimum value this method should send the entrypoint.
     *  this value MAY be zero, in case there is enough deposit, or the userOp has a paymaster.
     */
    function _payPrefund(uint256 missingAccountFunds) internal virtual {
        if (missingAccountFunds != 0) {
            (bool success,) = payable(msg.sender).call{value : missingAccountFunds, gas : type(uint256).max}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not account.)
        }
    }
}
