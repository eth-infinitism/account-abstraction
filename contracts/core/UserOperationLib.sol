// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/* solhint-disable no-inline-assembly */

import "../interfaces/PackedUserOperation.sol";
import "./Helpers.sol";

/**
 * Utility functions helpful when working with UserOperation structs.
 */
library UserOperationLib {

    error InvalidPaymasterSignatureLength(uint256 dataLength, uint256 pmSignatureLength);

    uint256 public constant PAYMASTER_VALIDATION_GAS_OFFSET = 20;
    uint256 public constant PAYMASTER_POSTOP_GAS_OFFSET = 36;
    uint256 public constant PAYMASTER_DATA_OFFSET = 52;

    uint256 constant internal PAYMASTER_SIG_MAGIC_LEN = 8;
    uint256 constant internal PAYMASTER_SUFFIX_LEN = PAYMASTER_SIG_MAGIC_LEN + 2; // suffix length (signature length + magic)
    bytes8 constant internal  PAYMASTER_SIG_MAGIC = 0x22e325a297439656; // keccak("PaymasterSignature")[:8]
    uint256 constant internal MIN_PAYMASTER_DATA_WITH_SUFFIX_LEN = PAYMASTER_DATA_OFFSET + PAYMASTER_SUFFIX_LEN; // minimum length of paymasterData that can contain a paymaster signature.

    /**
     * Relayer/block builder might submit the TX with higher priorityFee,
     * but the user should not pay above what he signed for.
     * @param userOp - The user operation data.
     */
    function gasPrice(
        PackedUserOperation calldata userOp
    ) internal view returns (uint256) {
        unchecked {
            (uint256 maxPriorityFeePerGas, uint256 maxFeePerGas) = unpackUints(userOp.gasFees);
            return min(maxFeePerGas, maxPriorityFeePerGas + block.basefee);
        }
    }

    bytes32 internal constant PACKED_USEROP_TYPEHASH =
    // solhint-disable-next-line gas-small-strings
    keccak256(
        "PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)"
    );

    /**
     * Pack the user operation data into bytes for hashing.
     * @param userOp - The user operation data.
     * @param overrideInitCodeHash - If set, encode this instead of the initCode field in the userOp.
     */
    function encode(
        PackedUserOperation calldata userOp,
        bytes32 overrideInitCodeHash
    ) internal pure returns (bytes memory ret) {
        address sender = userOp.sender;
        uint256 nonce = userOp.nonce;
        bytes32 hashInitCode = overrideInitCodeHash != 0 ? overrideInitCodeHash : calldataKeccak(userOp.initCode);
        bytes32 hashCallData = calldataKeccak(userOp.callData);
        bytes32 accountGasLimits = userOp.accountGasLimits;
        uint256 preVerificationGas = userOp.preVerificationGas;
        bytes32 gasFees = userOp.gasFees;
        bytes32 hashPaymasterAndData = paymasterDataKeccak(userOp.paymasterAndData);

        return abi.encode(
            UserOperationLib.PACKED_USEROP_TYPEHASH,
            sender, nonce,
            hashInitCode, hashCallData,
            accountGasLimits, preVerificationGas, gasFees,
            hashPaymasterAndData
        );
    }

    function unpackUints(
        bytes32 packed
    ) internal pure returns (uint256 high128, uint256 low128) {
        return (unpackHigh128(packed), unpackLow128(packed));
    }

    // Unpack just the high 128-bits from a packed value
    function unpackHigh128(bytes32 packed) internal pure returns (uint256) {
        return uint256(packed) >> 128;
    }

    // Unpack just the low 128-bits from a packed value
    function unpackLow128(bytes32 packed) internal pure returns (uint256) {
        return uint128(uint256(packed));
    }

    function unpackMaxPriorityFeePerGas(PackedUserOperation calldata userOp)
    internal pure returns (uint256) {
        return unpackHigh128(userOp.gasFees);
    }

    function unpackMaxFeePerGas(PackedUserOperation calldata userOp)
    internal pure returns (uint256) {
        return unpackLow128(userOp.gasFees);
    }

    function unpackVerificationGasLimit(PackedUserOperation calldata userOp)
    internal pure returns (uint256) {
        return unpackHigh128(userOp.accountGasLimits);
    }

    function unpackCallGasLimit(PackedUserOperation calldata userOp)
    internal pure returns (uint256) {
        return unpackLow128(userOp.accountGasLimits);
    }

    function unpackPaymasterVerificationGasLimit(PackedUserOperation calldata userOp)
    internal pure returns (uint256) {
        return uint128(bytes16(userOp.paymasterAndData[PAYMASTER_VALIDATION_GAS_OFFSET : PAYMASTER_POSTOP_GAS_OFFSET]));
    }

    function unpackPostOpGasLimit(PackedUserOperation calldata userOp)
    internal pure returns (uint256) {
        return uint128(bytes16(userOp.paymasterAndData[PAYMASTER_POSTOP_GAS_OFFSET : PAYMASTER_DATA_OFFSET]));
    }

    function unpackPaymasterStaticFields(
        bytes calldata paymasterAndData
    ) internal pure returns (address paymaster, uint256 validationGasLimit, uint256 postOpGasLimit) {
        return (
            address(bytes20(paymasterAndData[: PAYMASTER_VALIDATION_GAS_OFFSET])),
            uint128(bytes16(paymasterAndData[PAYMASTER_VALIDATION_GAS_OFFSET : PAYMASTER_POSTOP_GAS_OFFSET])),
            uint128(bytes16(paymasterAndData[PAYMASTER_POSTOP_GAS_OFFSET : PAYMASTER_DATA_OFFSET]))
        );
    }

    /**
     * return the length of the paymaster signature appended in paymasterAndData.
     * return 0 if no signature.
     * note that this signature is not part of the userOpHash, and thus not signed by the user.
     */
    function getPaymasterSignatureLength(
        bytes calldata paymasterAndData
    ) internal pure returns (uint256 paymasterSignatureLength) {
        unchecked {
            uint256 dataLength = paymasterAndData.length;
            if (dataLength < MIN_PAYMASTER_DATA_WITH_SUFFIX_LEN) {
                return 0;
            }
            bytes8 suffix8 = bytes8(paymasterAndData[dataLength - PAYMASTER_SIG_MAGIC_LEN : dataLength]);
            if (suffix8 != PAYMASTER_SIG_MAGIC) {
                return 0;
            }
            uint256 pmSignatureLength = uint16(bytes2(paymasterAndData[dataLength - PAYMASTER_SUFFIX_LEN :]));

            if (pmSignatureLength > dataLength - MIN_PAYMASTER_DATA_WITH_SUFFIX_LEN) {
                // paymasterSignature cannot extend before the paymasterData
                revert InvalidPaymasterSignatureLength(dataLength, pmSignatureLength);
            }
            return pmSignatureLength;
        }
    }

    /**
     * return the paymasterData that is signed by the user's signature
     * this data excludes the paymaster signature appended at the end of paymasterAndData
     */
    function getSignedPaymasterData(
        bytes calldata paymasterAndData
    ) internal pure returns (bytes calldata signedPaymasterData) {
        uint256 sigLen = getPaymasterSignatureLength(paymasterAndData);
        uint256 paymasterDataLen = paymasterAndData.length;
        if (sigLen != 0) {
            paymasterDataLen -= (sigLen + PAYMASTER_SUFFIX_LEN);
        }
        return paymasterAndData[PAYMASTER_DATA_OFFSET : paymasterDataLen];
    }

    /**
     * decodes dynamic signature appended to paymasterAndData
     * note that this signature is not part of the userOpHash, and thus not signed by the user.
     * @param paymasterAndData - The paymasterAndData field of the user operation
     * @return pmSig the paymaster-specific signature (may be empty)
     */
    function getPaymasterSignature(bytes calldata paymasterAndData
    ) internal pure returns (bytes calldata pmSig) {
        uint256 len = getPaymasterSignatureLength(paymasterAndData);
        return getPaymasterSignatureWithLength(paymasterAndData, len);
    }

    /**
     * decodes dynamic signature appended to paymasterAndData
     * Assumes the length field is valid, and was obtained from getPaymasterSignatureLength
     * @param paymasterAndData - The paymasterAndData field of the user operation
     * @param paymasterSignatureLength - length of the signature (as returned by getPaymasterSignatureLength)
     * @return pmSig the paymaster-specific signature (may be empty)
     */
    function getPaymasterSignatureWithLength(
        bytes calldata paymasterAndData, uint256 paymasterSignatureLength
    ) internal pure returns (bytes calldata pmSig) {
        if (paymasterSignatureLength == 0) {
            return paymasterAndData[0 : 0];
        }
        uint256 dataLen = paymasterAndData.length;
        unchecked {
            uint256 pmSigEnd = dataLen - PAYMASTER_SUFFIX_LEN;
            uint256 pmSigBegin =  pmSigEnd - paymasterSignatureLength;
            return paymasterAndData[pmSigBegin : pmSigEnd];
        }
    }

    /**
     * encode the paymaster signature as suffix to append to paymasterAndData
     * This method is a reference for off-chain encoding of paymaster signature.
     */
    function encodePaymasterSignature(bytes calldata paymasterSignature) internal pure returns (bytes memory) {
        uint256 len = paymasterSignature.length;
        if (len == 0) {
            return "";
        }

        return abi.encodePacked(
            paymasterSignature,
            uint16(len),
            PAYMASTER_SIG_MAGIC
        );
    }

    /**
     * Hash the user operation data.
     * @param userOp - The user operation data.
     * @param overrideInitCodeHash - If set, the initCode hash will be replaced with this value just for UserOp hashing.
     */
    function hash(
        PackedUserOperation calldata userOp,
        bytes32 overrideInitCodeHash
    ) internal pure returns (bytes32) {
        return keccak256(encode(userOp, overrideInitCodeHash));
    }
}
