// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "./TestPaymasterAcceptAll.sol";
/* solhint-disable no-empty-blocks */

/**
 * test paymaster, that pays for everything, without any check.
 * explicitly returns a context, to test cost (for entrypoint) to call postOp
 */
contract GasCalcPaymasterWithPostOp is TestPaymasterAcceptAll {
    constructor(IEntryPoint _entryPoint) TestPaymasterAcceptAll(_entryPoint) {
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata, bytes32, uint256)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        // return a context, to force a call for postOp.
        return ("1", SIG_VALIDATION_SUCCESS);
    }

    function _postOp(PostOpMode, bytes calldata, uint256 actualGasCost, uint256)
    internal override {
    }
}
