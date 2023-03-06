// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../core/Helpers.sol";

contract TestHelpers {

    function parseValidationData(uint validationData) public pure returns (ValidationData memory) {
        return _parseValidationData(validationData);
    }

    function intersectTimeRange(uint256 validationData, uint256 paymasterValidationData) public pure returns (ValidationData memory) {
        return _intersectTimeRange(validationData, paymasterValidationData);
    }

    function packValidationDataStruct(ValidationData memory data) public pure returns (uint256) {
        return _packValidationData(data);
    }

    function packValidationData(bool sigFailed, uint48 validUntil, uint48 validAfter) public pure returns (uint256) {
        return _packValidationData(sigFailed, validUntil, validAfter);
    }
}
