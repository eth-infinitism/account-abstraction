// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../core/Helpers.sol";

contract TestHelpers {

    function parseSigTimeRange(uint validationData) public pure returns (ValidationData memory) {
        return _parseValidationData(validationData);
    }

    function intersectTimeRange(uint256 validationData, uint256 paymasterTimeRange) public pure returns (ValidationData memory) {
        return _intersectTimeRange(validationData, paymasterTimeRange);
    }

    function _packValidationDataStruct(ValidationData memory data) public pure returns (uint256) {
        return _packValidationData(data);
    }

    function packSigTimeRange(bool sigFailed, uint48 validUntil, uint48 validAfter) public pure returns (uint256) {
        return _packValidationData(sigFailed, validUntil, validAfter);
    }
}
