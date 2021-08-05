// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./UserOperation.sol";

interface IPaymaster {

    // pre-pay for the call validate user operation, and if agrees to pay (from stake)
    // revert to reject this request.
    // @returns context value to send to a postOp
    //  value is zero to signify postOp is not required at all.
    function payForOp(UserOperation calldata userOp) external returns (bytes32 context);

    // post-operation handler.
    // @param postRevert - after inner call reverted, this method is retried in the outer context.
    //          should NOT revert then (otherwise, miner will block this paymaster)
    // @param context - the context value returned by payForOp
    // @param actualGasCost - actual gas used so far (without the postOp itself).
    function postOp(bool postRevert, bytes32 context, uint actualGasCost) external;
}
