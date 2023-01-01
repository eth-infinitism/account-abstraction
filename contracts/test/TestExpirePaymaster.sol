// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../core/BasePaymaster.sol";

/**
 * test expiry mechanism: paymasterData is encoded "sigTimeRange" timestamp
 */
contract TestExpirePaymaster is BasePaymaster {
    // solhint-disable no-empty-blocks
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint)
    {}

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint maxCost) external virtual override view
    returns (bytes memory context, uint256 sigTimeRange) {
        (userOp, userOpHash, maxCost);
        sigTimeRange = packSigTimeRange(false, uint256(bytes32(userOp.paymasterAndData[20 :])), 0);
        context = "";
    }
}
