// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../core/BasePaymaster.sol";

/**
 * test expiry mechanism: paymasterData encodes the "validUntil" and validAfter" times
 */
contract TestExpirePaymaster is BasePaymaster {
    // solhint-disable no-empty-blocks
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint)
    {}

    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint maxCost)
    internal virtual override view
    returns (bytes memory context, uint256 sigTimeRange) {
        (userOp, userOpHash, maxCost);
        (uint64 validAfter, uint64 validUntil) = abi.decode(userOp.paymasterAndData[20 :], (uint64, uint64));
        sigTimeRange = packSigTimeRange(false, validUntil, validAfter);
        context = "";
    }
}
