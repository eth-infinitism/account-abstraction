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

    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        (userOp, userOpHash, maxCost);
        (uint48 validAfter, uint48 validUntil) = abi.decode(userOp.paymasterAndData[20 :], (uint48, uint48));
        validationData = _packValidationData(false, validUntil, validAfter);
        context = "";
    }
}
