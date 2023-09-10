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

    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32, uint256)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        validationData = 0;
        context = abi.encodePacked(userOp.sender);
    }

    function _postOp(PostOpMode mode, bytes calldata, uint256) internal pure override {
        if(mode == PostOpMode.postOpReverted) {
            return;
        }

        revert CustomError();
    }
}
