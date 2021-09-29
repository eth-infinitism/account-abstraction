// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./UserOperation.sol";

interface IPaymaster {

    enum PostOpMode {
        opSucceeded, // user op succeeded
        opReverted, // user op reverted. still has to pay for gas.
        postOpReverted //user op succeeded, but caused postOp to revert. Now its a 2nd call, after user's op was deliberately reverted.
    }
    // payment validation: check if paymaster agree to pay (using its stake)
    // revert to reject this request.
    // actual payment is done after postOp is called, by deducting actual call cost form the paymaster's stake.
    // @param userOp the user operation
    // @param maxcost the maximum cost of this transaction (based on maximum gas and gas price from userOp)
    // @returns context value to send to a postOp
    //  zero length to signify postOp is not required.
    function verifyPaymasterUserOp(UserOperation calldata userOp, uint maxcost) external view returns (bytes memory context);

    // post-operation handler.
    // @param mode
    //      opSucceeded - user operation succeeded.
    //      opReverted  - user op reverted. still has to pay for gas.
    //      postOpReverted - user op succeeded, but caused postOp (in mode=opSucceeded) to revert.
    //                       Now this is the 2nd call, after user's op was deliberately reverted.
    // @param context - the context value returned by verifyPaymasterUserOp
    // @param actualGasCost - actual gas used so far (without this postOp call).
    function postOp(PostOpMode mode, bytes calldata context, uint actualGasCost) external;
}
