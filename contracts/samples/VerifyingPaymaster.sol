// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "../EntryPoint.sol";
import "../BasePaymaster.sol";

/**
 * A sample paymaster that uses external service to decide whether to pay for the UserOp.
 * The paymaster trusts an external signer to sign the transaction.
 * The calling user must pass the UserOp to that external signer first, which performs
 * whatever off-chain verification before signing the UserOp.
 * Note that this signature is NOT a replacement for wallet signature:
 * - the paymaster signs to agree to PAY for GAS.
 * - the wallet signs to prove identity and wallet ownership.
 */
contract VerifyingPaymaster is BasePaymaster {

    using UserOperationLib for UserOperation;

    address public immutable verifyingSigner;

    constructor(EntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_entryPoint) {
        verifyingSigner = _verifyingSigner;
    }

    // verify our external signer signed this request.
    // the "paymasterData" is supposed to be a signature over the entire request params
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*requestId*/, uint requiredPreFund) external view override returns (bytes memory context) {
        (requiredPreFund);

        bytes32 hash = userOp.hash();
        require(userOp.paymasterData.length >= 65, "VerifyingPaymaster: invalid signature length in paymasterData");
        (bytes32 r, bytes32 s) = abi.decode(userOp.paymasterData, (bytes32, bytes32));
        uint8 v = uint8(userOp.paymasterData[64]);
        require(verifyingSigner == ecrecover(hash, v, r, s), "VerifyingPaymaster: wrong signature");

        //no other on-chain validation: entire UserOp should have been checked by the external service,
        // prior signing it.
        return "";
    }

}
