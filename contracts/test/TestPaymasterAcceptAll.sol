// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../core/BasePaymaster.sol";

/**
 * test paymaster, that pays for everything, without any check.
 */
contract TestPaymasterAcceptAll is BasePaymaster {

    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint) {
        // to support "deterministic address" deployer
        // solhint-disable avoid-tx-origin
        if (tx.origin != msg.sender) {
            _transferOwnership(tx.origin);
        }
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint maxCost) external virtual override view
    returns (bytes memory context, uint256 deadline) {
        (userOp, userOpHash, maxCost);
        return ("", 0);
    }
}
