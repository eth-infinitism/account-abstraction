// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "../core/Helpers.sol";

contract TestHelpers {

    function parseValidationData(uint256 validationData) public pure returns (ValidationData memory) {
        return _parseValidationData(validationData);
    }

    function packValidationDataStruct(ValidationData memory data) public pure returns (uint256) {
        return _packValidationData(data);
    }

    function packValidationData(bool sigFailed, uint48 validUntil, uint48 validAfter) public pure returns (uint256) {
        return _packValidationData(sigFailed, validUntil, validAfter);
    }

    function getPaymasterSignatureLength(
        bytes calldata paymasterAndData
    ) public pure returns (uint256 paymasterSignatureLength) {
        return UserOperationLib.getPaymasterSignatureLength(paymasterAndData);
    }

    function getPaymasterSignatureWithLength(
        bytes calldata paymasterAndData, uint256 paymasterSignatureLength
    ) public  pure returns (bytes calldata) {
        return UserOperationLib.getPaymasterSignatureWithLength(paymasterAndData, paymasterSignatureLength);
    }

    function encodePaymasterSignature(bytes calldata paymasterSignature) public pure returns (bytes memory) {
        return UserOperationLib.encodePaymasterSignature(paymasterSignature);
    }

    function _calldataKeccakWithSuffix(bytes calldata data, uint256 len, bytes8 suffix) public pure returns (bytes32 ret) {
        return calldataKeccakWithSuffix(data, len, suffix);
    }
}
