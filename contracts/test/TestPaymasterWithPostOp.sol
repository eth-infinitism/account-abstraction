// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "./TestPaymasterAcceptAll.sol";
/* solhint-disable no-empty-blocks */

/**
 * test paymaster, that pays for everything, without any check.
 * explicitly returns a context, to test cost (for entrypoint) to call postOp
 */
contract TestPaymasterWithPostOp is TestPaymasterAcceptAll {

    constructor(IEntryPoint _entryPoint) TestPaymasterAcceptAll(_entryPoint) {
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        (userOp, userOpHash, maxCost);
        // return a context, to force a call for postOp.
        return ("1", 0);
    }

    function _postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) internal override {
    }
}
