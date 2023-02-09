// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../core/Helpers.sol";

contract TestHelpers {

    function parseSigTimeRange(uint sigTimeRange) public pure returns (address sigAuthorizer, uint48 validAfter, uint48 validUntil) {
        return _parseSigTimeRange(sigTimeRange);
    }

    function intersectTimeRange(uint256 sigTimeRange, uint256 paymasterTimeRange) public pure returns (address sigAuthorizer, uint48 validAfter, uint48 validUntil) {
        return _intersectTimeRange(sigTimeRange, paymasterTimeRange);
    }

    function packSigTimeRangeAgg(address sigAuthorizer, uint48 validUntil, uint48 validAfter) public pure returns (uint256) {
        return _packSigTimeRange(sigAuthorizer, validUntil, validAfter);
    }

    function packSigTimeRange(bool sigFailed, uint48 validUntil, uint48 validAfter) public pure returns (uint256) {
        return _packSigTimeRange(sigFailed, validUntil, validAfter);
    }
}
