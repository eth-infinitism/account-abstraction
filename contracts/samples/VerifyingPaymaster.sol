// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../EntryPoint.sol";
import "../BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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

    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;

    address public immutable verifyingSigner;

    constructor(EntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_entryPoint) {
        verifyingSigner = _verifyingSigner;
    }

    // return the hash we're going to sign off-chain (and validate on-chain)
    function getHash(UserOperation calldata userOp)
    public pure returns (bytes32) {
        //can't use userOp.hash(), since it contains also the paymasterData itself.
        return keccak256(abi.encode(
                userOp.getSender(),
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGas,
                userOp.verificationGas,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                userOp.paymaster
            ));
    }

    // verify our external signer signed this request.
    // the "paymasterData" is supposed to be a signature over the entire request params
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*requestId*/, uint requiredPreFund)
    external view override returns (bytes memory context) {
        (requiredPreFund);

        bytes32 hash = getHash(userOp);
        uint sigLength = userOp.paymasterData.length;
        require(sigLength == 64 || sigLength == 65, "VerifyingPaymaster: invalid signature length in paymasterData");
        require(verifyingSigner == hash.toEthSignedMessageHash().recover(userOp.paymasterData), "VerifyingPaymaster: wrong signature");

        //no need for other on-chain validation: entire UserOp should have been checked
        // by the external service prior signing it.
        return "";
    }

}
