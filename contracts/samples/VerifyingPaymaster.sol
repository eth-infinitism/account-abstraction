// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable reason-string */
/* solhint-disable no-inline-assembly */

import "../core/BasePaymaster.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
/**
 * A sample paymaster that uses external service to decide whether to pay for the UserOp.
 * The paymaster trusts an external signer to sign the transaction.
 * The calling user must pass the UserOp to that external signer first, which performs
 * whatever off-chain verification before signing the UserOp.
 * Note that this signature is NOT a replacement for the account-specific signature:
 * - the paymaster checks a signature to agree to PAY for GAS.
 * - the account checks a signature to prove identity and account ownership.
 */
contract VerifyingPaymaster is BasePaymaster {

    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;

    address public immutable verifyingSigner;

    uint256 private constant VALID_TIMESTAMP_OFFSET = 20;

    uint256 private constant SIGNATURE_OFFSET = 84;

    constructor(IEntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_entryPoint) {
        verifyingSigner = _verifyingSigner;
    }

    mapping(address => uint256) public senderNonce;

    function pack(UserOperation calldata userOp) internal pure returns (bytes memory ret) {
        bytes calldata pnd = userOp.paymasterAndData;
        // copy directly the userOp from calldata up to (but not including) the paymasterAndData.
        // also remove the two pointers to the paymasterAndData and the signature (which are 64 bytes long).
        // this encoding depends on the ABI encoding of calldata, but is much lighter to copy
        // than referencing each field separately.

        // the layout of the UserOp calldata is:

        // sender: 32 bytes - the sender address
        // nonce: 32 bytes - the nonce
        // initCode offset: 32 bytes - the offset of the initCode (this is the offset instead of the initCode itself because it's dynamic bytes)
        // callData offset: 32 bytes - the offset of the callData (this is the offset instead of the callData itself because it's dynamic bytes)
        // callGasLimit: 32 bytes - the callGasLimit
        // verificationGasLimit: 32 bytes - the verificationGasLimit
        // preVerificationGas: 32 bytes - the preVerificationGas
        // maxFeePerGas: 32 bytes - the maxFeePerGas
        // maxPriorityFeePerGas: 32 bytes - the maxPriorityFeePerGas
        // paymasterAndData offset: 32 bytes - the offset of the paymasterAndData (this is the offset instead of the paymasterAndData itself because it's dynamic bytes)
        // signature offset: 32 bytes - the offset of the signature (this is the offset instead of the signature itself because it's dynamic bytes)
        // initCode: dynamic bytes - the initCode
        // callData: dynamic bytes - the callData
        // paymasterAndData: dynamic bytes - the paymasterAndData
        // signature: dynamic bytes - the signature

        // during packing, we remove the signature offset, the paymasterAndData offset, the paymasterAndData, and the signature. 
        // however, we need to glue the initCode and callData back together with the rest of the UserOp

        assembly {
            let ofs := userOp
            // the length of the UserOp struct, up to and including the maxPriorityFeePerGas field
            let len1 := 288 
            // the length of the initCode and callData dynamic bytes added together (skipping the paymasterAndData offset and signature offset)
            let len2 := sub(sub(pnd.offset, ofs), 384) 
            let totalLen := add(len1, len2)
            ret := mload(0x40)
            mstore(0x40, add(ret, add(totalLen, 32)))
            mstore(ret, totalLen)
            calldatacopy(add(ret, 32), ofs, len1)
            // glue the first part of the UserOp back with the initCode and callData
            calldatacopy(add(add(ret, 32), len1), add(add(ofs, len1), 64), len2) 
        }

        // in the end, we are left with:

        // sender: 32 bytes - the sender address
        // nonce: 32 bytes - the nonce
        // initCode offset: 32 bytes - the offset of the initCode (this is the offset instead of the initCode itself because it's dynamic bytes)
        // callData offset: 32 bytes - the offset of the callData (this is the offset instead of the callData itself because it's dynamic bytes)
        // callGasLimit: 32 bytes - the callGasLimit
        // verificationGasLimit: 32 bytes - the verificationGasLimit
        // preVerificationGas: 32 bytes - the preVerificationGas
        // maxFeePerGas: 32 bytes - the maxFeePerGas
        // maxPriorityFeePerGas: 32 bytes - the maxPriorityFeePerGas
        // initCode: dynamic bytes - the initCode
        // callData: dynamic bytes - the callData

        // the initCode offset and callData offset are now incorrect, but we don't need them anyway so we can ignore them.
    }

    /**
     * return the hash we're going to sign off-chain (and validate on-chain)
     * this method is called by the off-chain service, to sign the request.
     * it is called on-chain from the validatePaymasterUserOp, to validate the signature.
     * note that this signature covers all fields of the UserOperation, except the "paymasterAndData",
     * which will carry the signature itself.
     */
    function getHash(UserOperation calldata userOp, uint48 validUntil, uint48 validAfter)
    public view returns (bytes32) {
        //can't use userOp.hash(), since it contains also the paymasterAndData itself.

        return keccak256(abi.encode(
                pack(userOp),
                block.chainid,
                address(this),
                senderNonce[userOp.getSender()],
                validUntil,
                validAfter
            ));
    }

    /**
     * verify our external signer signed this request.
     * the "paymasterAndData" is expected to be the paymaster and a signature over the entire request params
     * paymasterAndData[:20] : address(this)
     * paymasterAndData[20:84] : abi.encode(validUntil, validAfter)
     * paymasterAndData[84:] : signature
     */
    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*userOpHash*/, uint256 requiredPreFund)
    internal override returns (bytes memory context, uint256 validationData) {
        (requiredPreFund);

        (uint48 validUntil, uint48 validAfter, bytes calldata signature) = parsePaymasterAndData(userOp.paymasterAndData);
        //ECDSA library supports both 64 and 65-byte long signatures.
        // we only "require" it here so that the revert reason on invalid signature will be of "VerifyingPaymaster", and not "ECDSA"
        require(signature.length == 64 || signature.length == 65, "VerifyingPaymaster: invalid signature length in paymasterAndData");
        bytes32 hash = ECDSA.toEthSignedMessageHash(getHash(userOp, validUntil, validAfter));
        senderNonce[userOp.getSender()]++;

        //don't revert on signature failure: return SIG_VALIDATION_FAILED
        if (verifyingSigner != ECDSA.recover(hash, signature)) {
            return ("",_packValidationData(true,validUntil,validAfter));
        }

        //no need for other on-chain validation: entire UserOp should have been checked
        // by the external service prior to signing it.
        return ("",_packValidationData(false,validUntil,validAfter));
    }

    function parsePaymasterAndData(bytes calldata paymasterAndData) public pure returns(uint48 validUntil, uint48 validAfter, bytes calldata signature) {
        (validUntil, validAfter) = abi.decode(paymasterAndData[VALID_TIMESTAMP_OFFSET:SIGNATURE_OFFSET],(uint48, uint48));
        signature = paymasterAndData[SIGNATURE_OFFSET:];
    }
}
