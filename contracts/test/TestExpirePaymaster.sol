// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../core/BasePaymaster.sol";

/**
 * test expiry mechanism: paymasterData is encoded "deadline" timestamp
 */
contract TestExpirePaymaster is BasePaymaster {
    // solhint-disable no-empty-blocks
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint)
    {}

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 requestId, uint maxCost) external virtual override view
    returns (bytes memory context, uint256 deadline) {
        (userOp, requestId, maxCost);
        deadline = uint256(bytes32(userOp.paymasterAndData[20:]));
        context = "";
    }
}
