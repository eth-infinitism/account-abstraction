// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./UserOperation.sol";

interface IPaymaster {

    enum PostOpMode {
        opSucceeded, // user op succeeded
        opReverted, // user op reverted. still has to pay for gas.
        postOpReverted //user op succeeded, but caused postOp to revert. Now its a 2nd call, after user's op was deliberately reverted.
    }
    // pre-pay validation: check if paymaster agree to pay (using its stake)
    // revert to reject this request.
    // @returns context value to send to a postOp
    //  zero value to signify postOp is not required.
    function payForOp(UserOperation calldata userOp) external view returns (bytes32 context);

    // post-operation handler.
    // @param mode  - false when call just after target is called.
    //      true - in case first postOp() call reverted, then the user's operation is reverted, and
    //           postOp is called again, with portRevert=true)
    // @param context - the context value returned by payForOp
    // @param actualGasCost - actual gas used so far (without this postOp call).
    function postOp(PostOpMode mode, UserOperation calldata userOp, bytes32 context, uint actualGasCost) external;
}
