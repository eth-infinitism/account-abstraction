// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "../core/BasePaymaster.sol";
import "../core/UserOperationLib.sol";
import "../core/Helpers.sol";

/* solhint-disable gas-custom-errors */

/**
 * test paymaster sig:
 * a paymaster that handles different "signature" appended after the UserOperation was signed by the user.
 * valid signature is when the two uint256 numbers in the signature add to 100...
 */
contract TestPaymasterWithSig is BasePaymaster {

    // solhint-disable no-empty-blocks
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint, msg.sender)
    {}

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        (userOpHash, maxCost);
        bytes memory signedPaymasterData = UserOperationLib.getSignedPaymasterData(userOp.paymasterAndData);
        (uint256 testData) = abi.decode(signedPaymasterData, (uint256));
        require(testData & 0xff == 0x11, "expected testData=0x11");

        uint256 len = UserOperationLib.getPaymasterSignatureLength(userOp.paymasterAndData);
        require(len > 0, "missing paymasterSig");
        bytes calldata paymasterSignature = UserOperationLib.getPaymasterSignatureWithLength(userOp.paymasterAndData, len);
        (uint256 a, uint256 b) = abi.decode(paymasterSignature, (uint256, uint256));
        if (a + b != 100) {
            return ("", SIG_VALIDATION_FAILED);
        }
        return ("", SIG_VALIDATION_SUCCESS);
    }
}
