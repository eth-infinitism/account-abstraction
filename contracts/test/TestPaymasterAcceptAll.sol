// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../core/BasePaymaster.sol";
/* solhint-disable no-empty-blocks */

/**
 * test paymaster, that pays for everything, without any check.
 */
contract TestPaymasterAcceptAll is BasePaymaster {

    bool private immutable callPostOp;
    constructor(IEntryPoint _entryPoint, bool _callPostOp) BasePaymaster(_entryPoint) {
        // to support "deterministic address" factory
        // solhint-disable avoid-tx-origin
        callPostOp = _callPostOp;
        if (tx.origin != msg.sender) {
            _transferOwnership(tx.origin);
        }

    }

    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        (userOp, userOpHash, maxCost);
        if ( callPostOp) {
            // return a context, to force a call for postOp.
            return ("1", 0);
        } else {
            return ("", 0);
        }
    }

    function _postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) internal override {
    }
}
