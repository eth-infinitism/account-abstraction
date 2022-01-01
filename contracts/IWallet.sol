// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./UserOperation.sol";

interface IWallet {

    /**
     * Validate user's signature and nonce
     * the entryPoint will make the call to the recipient only if this validation call returns successfuly.
     *
     * @dev Must validate caller is the entryPoint.
     *      Must validate the signature and nonce
     * @param userOp the operation that is about to be executed.
     * @param requiredPrefund the minimum amount to transfer to the sender(entryPoint) to be able to make the call.
     *      The excess is left as a deposit in the entrypoint, for future calls.
     *      can be withdrawn anytime using "entryPoint.withdrawTo()"
     *      In case there is a paymaster in the request (or the current deposit is high enough), this value will be zero.
     */
    function validateUserOp(UserOperation calldata userOp, uint requiredPrefund) external;
}
