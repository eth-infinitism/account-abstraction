// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

/* solhint-disable no-empty-blocks */

import "./TestPaymasterAcceptAll.sol";

/**
 * test paymaster, that pays for everything, without any check.
 * explicitly returns a context, to test cost (for entrypoint) to call postOp
 */
contract TestPaymasterWithPostOp is TestPaymasterAcceptAll {
    event PostOpActualGasCost(uint256 actualGasCost, bytes context, bool isSame);

    bytes public theContext;

    constructor(IEntryPoint _entryPoint) TestPaymasterAcceptAll(_entryPoint) {
        setContext("1");
    }

    function setContext(bytes memory _context) public {
        theContext = _context;
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata, bytes32, uint256)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        // return a context, to force a call for postOp.
        return (theContext, SIG_VALIDATION_SUCCESS);
    }

    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256)
    internal override {
        bool isSame = keccak256(context) == keccak256(theContext);
        emit PostOpActualGasCost(actualGasCost, context, isSame);

    }
}
