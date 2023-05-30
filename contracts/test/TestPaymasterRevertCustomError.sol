// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../core/BasePaymaster.sol";

/**
 * test postOp revert with custom error
 */
error CustomError();

contract TestPaymasterRevertCustomError is BasePaymaster {
    // solhint-disable no-empty-blocks
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint)
    {}

    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        validationData = 0;
        context = abi.encodePacked(userOp.sender);
    }

    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) internal override {
        if(mode == PostOpMode.postOpReverted) {
            return;
        }

        revert CustomError();
    }
}
