// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/* solhint-disable no-inline-assembly */

import "../interfaces/PackedUserOperation.sol";
import {calldataKeccak, min} from "./Helpers.sol";

/**
 * Utility functions helpful when working with UserOperation structs.
 */
library UserOperationLib {

    uint256 public constant PAYMASTER_VALIDATION_GAS_OFFSET = 20;
    uint256 public constant PAYMASTER_POSTOP_GAS_OFFSET = 36;
    uint256 public constant PAYMASTER_DATA_OFFSET = 52;

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
        bytes32 hashPaymasterAndData = calldataKeccak(userOp.paymasterAndData);

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
