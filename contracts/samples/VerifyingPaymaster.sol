// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable reason-string */

import "../core/BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * A sample paymaster that uses external service to decide whether to pay for the UserOp.
 * The paymaster trusts an external signer to sign the transaction.
 * The calling user must pass the UserOp to that external signer first, which performs
 * whatever off-chain verification before signing the UserOp.
 * Note that this signature is NOT a replacement for wallet signature:
 * - the paymaster signs to agree to PAY for GAS.
 * - the wallet signs to prove identity and account ownership.
 */
contract VerifyingPaymaster is BasePaymaster {

    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;

    address public immutable verifyingSigner;

    uint256 private constant VALID_TIMESTAMP_OFFSET = 20;

    uint256 private constant SIGNATURE_OFFSET = 36;

    constructor(IEntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_entryPoint) {
        verifyingSigner = _verifyingSigner;
    }

    mapping(address => uint256) public senderNonce;

    /**
     * return the hash we're going to sign off-chain (and validate on-chain)
     * this method is called by the off-chain service, to sign the request.
     * it is called on-chain from the validatePaymasterUserOp, to validate the signature.
     * note that this signature covers all fields of the UserOperation, except the "paymasterAndData",
     * which will carry the signature itself.
     */
    function getHash(UserOperation calldata userOp)
    public view returns (bytes32) {
        //can't use userOp.hash(), since it contains also the paymasterAndData itself.
        //audit : why can't we use paymasterAndData for hash? i think we need it
        address sender = userOp.getSender();
        return keccak256(abi.encode(
                sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                block.chainid,
                address(this),
                userOp.paymasterAndData[VALID_TIMESTAMP_OFFSET:], //this is includes paymaster address, signature validity
                senderNonce[sender]
            ));
    }

    /**
     * verify our external signer signed this request.
     * the "paymasterAndData" is expected to be the paymaster and a signature over the entire request params
     * paymasterAndData[:20] : address(this)
     * paymasterAndData[20:28] : validUntil
     * paymasterAndData[28:36] : validAfter
     * paymasterAndData[36:] : signature
     */
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*userOpHash*/, uint256 requiredPreFund)
    external override returns (bytes memory context, uint256 sigTimeRange) {
        (requiredPreFund);

        bytes32 hash = getHash(userOp);
        senderNonce[userOp.getSender()]++;
        bytes calldata paymasterAndData = userOp.paymasterAndData;
        (uint64 validUntil, uint64 validAfter, bytes calldata signature) = parsePaymasterAndData(paymasterAndData);
        uint256 sigLength = signature.length;

        //ECDSA library supports both 64 and 65-byte long signatures.
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(sigLength == 64 || sigLength == 65, "VerifyingPaymaster: invalid signature length in paymasterAndData");

        //don't revert on signature failure: return SIG_VALIDATION_FAILED
        if (verifyingSigner != hash.toEthSignedMessageHash().recover(signature)) {
            return ("",encodeSigTimeRange(true,validUntil,validAfter));
        }

        //no need for other on-chain validation: entire UserOp should have been checked
        // by the external service prior to signing it.
        return ("",encodeSigTimeRange(false,validUntil,validAfter));
    }

    function encodeSigTimeRange(bool fail, uint64 validUntil, uint64 validAfter) public view returns(uint256) {
        return uint256(fail ? 1 : 0) << 248 | uint256(validUntil) << 184 | uint256(validAfter) << 120;
    }

    function parsePaymasterAndData(bytes calldata paymasterAndData) public view returns(uint64 validUntil, uint64 validAfter, bytes calldata signature) {
        assembly {
            validUntil := calldataload(sub(paymasterAndData.offset, 4))
            validAfter := calldataload(add(paymasterAndData.offset, 4))
        }
        signature = paymasterAndData[SIGNATURE_OFFSET:];
    }
}
