// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "./UserOperationLib.sol";

/* solhint-disable no-inline-assembly */

using UserOperationLib for bytes;

 /*
  * For simulation purposes, validateUserOp (and validatePaymasterUserOp)
  * must return this value in case of signature failure, instead of revert.
  */
uint256 constant SIG_VALIDATION_FAILED = 1;


/*
 * For simulation purposes, validateUserOp (and validatePaymasterUserOp)
 * return this value on success.
 */
uint256 constant SIG_VALIDATION_SUCCESS = 0;


/**
 * Returned data from validateUserOp.
 * validateUserOp returns a uint256, which is created by `_packedValidationData` and
 * parsed by `_parseValidationData`.
 * @param aggregator  - address(0) - The account validated the signature by itself.
 *                      address(1) - The account failed to validate the signature.
 *                      otherwise - This is an address of a signature aggregator that must
 *                                  be used to validate the signature.
 * @param validAfter  - This UserOp is valid only after this timestamp.
 * @param validUntil - Last timestamp this operation is valid at, or 0 for "indefinitely".
 */
struct ValidationData {
    address aggregator;
    uint48 validAfter;
    uint48 validUntil;
}

/**
 * Extract aggregator/sigFailed, validAfter, validUntil.
 * Also convert zero validUntil to type(uint48).max.
 * @param validationData - The packed validation data.
 * @return data - The unpacked in-memory validation data.
 */
function _parseValidationData(
    uint256 validationData
) pure returns (ValidationData memory data) {
    address aggregator = address(uint160(validationData));
    uint48 validUntil = uint48(validationData >> 160);
    if (validUntil == 0) {
        validUntil = type(uint48).max;
    }
    uint48 validAfter = uint48(validationData >> (48 + 160));
    return ValidationData(aggregator, validAfter, validUntil);
}

/**
 * Helper to pack the return value for validateUserOp.
 * @param data - The ValidationData to pack.
 * @return the packed validation data.
 */
function _packValidationData(
    ValidationData memory data
) pure returns (uint256) {
    return
        uint160(data.aggregator) |
        (uint256(data.validUntil) << 160) |
        (uint256(data.validAfter) << (160 + 48));
}

/**
 * Helper to pack the return value for validateUserOp, when not using an aggregator.
 * @param sigFailed  - True for signature failure, false for success.
 * @param validUntil - Last timestamp this operation is valid at, or 0 for "indefinitely".
 * @param validAfter - First timestamp this UserOperation is valid.
 * @return the packed validation data.
 */
function _packValidationData(
    bool sigFailed,
    uint48 validUntil,
    uint48 validAfter
) pure returns (uint256) {
    return
        (sigFailed ?  SIG_VALIDATION_FAILED : SIG_VALIDATION_SUCCESS) |
        (uint256(validUntil) << 160) |
        (uint256(validAfter) << (160 + 48));
}

/**
 * keccak function over calldata.
 * @dev copy calldata into memory, do keccak and drop allocated memory. Strangely, this is more efficient than letting solidity do it.
 *
 * @param data - the calldata bytes array to perform keccak on.
 * @return ret - the keccak hash of the 'data' array.
 */
function calldataKeccak(bytes calldata data) pure returns (bytes32 ret) {
    assembly ("memory-safe") {
        let mem := mload(0x40)
        let len := data.length
        calldatacopy(mem, data.offset, len)
        ret := keccak256(mem, len)
    }
}

/**
 * @notice Computes the Keccak-256 hash of a slice of calldata, followed by an 8-byte suffix.
 * This function copies the first `len` bytes from the given calldata array `data` into memory.
 * The assembly code is equivalent to:
 *      keccak256(abi.encodePacked(data[0:len], suffix))
 * But more efficient, and doesn't move the free memory pointer, allowing the memory to be reused later.
 *
 * @param data   Calldata byte array to read from.
 * @param len    Number of bytes to copy from `data` starting at its offset.
 * @param suffix 8-byte value appended to the data bytes before hashing.
 *
 * @return ret The hash of (data[0:len] || suffix).
 */
function calldataKeccakWithSuffix(bytes calldata data, uint256 len, bytes8 suffix) pure returns (bytes32 ret) {
    assembly ("memory-safe") {
        let mem := mload(0x40)
        calldatacopy(mem, data.offset, len)
        mstore(add(mem, len), suffix)
        len := add(len, 8)
        ret := keccak256(mem, len)
    }
}

/**
 * Keccak function over paymaster data.
 * If data ends with `PAYMASTER_SIG_MAGIC`, then
 * read the previous 2 bytes as pmSignatureLength,
 * and ignore this suffix from the hash.
 * This means that the trailing pmSignatureLength+10 bytes are not covered by the UserOpHash, and thus are not signed.
 * @dev copy calldata into memory, do keccak and drop allocated memory. Strangely, this is more efficient than letting solidity do it.
 *
 * @param data - the calldata bytes array to perform keccak on.
 * @return ret - the keccak hash of the 'data' array.
 */
function paymasterDataKeccak(bytes calldata data) pure returns (bytes32 ret) {
    uint256 pmSignatureLength = data.getPaymasterSignatureLength();
    if (pmSignatureLength > 0) {
        unchecked {
            //keccak everything up to the paymasterSignature, but still append the sig magic.
            return calldataKeccakWithSuffix(data, data.length - (pmSignatureLength + UserOperationLib.PAYMASTER_SUFFIX_LEN), UserOperationLib.PAYMASTER_SIG_MAGIC);
        }
    }
    return calldataKeccak(data);
}


/**
 * The minimum of two numbers.
 * @param a - First number.
 * @param b - Second number.
 * @return - the minimum value.
 */
    function min(uint256 a, uint256 b) pure returns (uint256) {
        return a < b ? a : b;
    }

/**
 * standard solidity memory allocation finalization.
 * copied from solidity generated code
 * @param memPointer - The current memory pointer
 * @param allocationSize - Bytes allocated from memPointer.
 */
    function finalizeAllocation(uint256 memPointer, uint256 allocationSize) pure {

        assembly ("memory-safe"){
            finalize_allocation(memPointer, allocationSize)

            function finalize_allocation(memPtr, size) {
                let newFreePtr := add(memPtr, round_up_to_mul_of_32(size))
                mstore(64, newFreePtr)
            }

            function round_up_to_mul_of_32(value) -> result {
                result := and(add(value, 31), not(31))
            }
        }
    }
