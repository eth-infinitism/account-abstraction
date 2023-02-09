// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

//extract sigFailed, validAfter, validUntil.
// also convert zero validUntil to type(uint48).max
    function _parseSigTimeRange(uint sigTimeRange) pure returns (address sigAuthorizer, uint48 validAfter, uint48 validUntil) {
        sigAuthorizer = address(uint160(sigTimeRange));
        // subtract one, to explicitly treat zero as max-value
        validUntil = uint48(sigTimeRange >> 160);
        if (validUntil == 0) {
            validUntil = type(uint48).max;
        }
        validAfter = uint48(sigTimeRange >> (48 + 160));
    }

// intersect account and paymaster ranges.
    function _intersectTimeRange(uint256 sigTimeRange, uint256 paymasterTimeRange) pure returns (address sigAuthorizer, uint48 validAfter, uint48 validUntil) {
        (sigAuthorizer, validAfter, validUntil) = _parseSigTimeRange(sigTimeRange);
        (address pmsigAuthorizer, uint48 pmValidAfter, uint48 pmValidUntil) = _parseSigTimeRange(paymasterTimeRange);
        if (sigAuthorizer == address(0)) {
            sigAuthorizer = pmsigAuthorizer;
        }

        if (validAfter < pmValidAfter) validAfter = pmValidAfter;
        if (validUntil > pmValidUntil) validUntil = pmValidUntil;
    }

/**
 * helper to pack the return value for validateUserOp
 * @param sigAuthorizer - 0 for success, 1 for failed, address for external service (aggregator)
 * @param validUntil last timestamp this UserOperation is valid (or zero for infinite)
 * @param validAfter first timestamp this UserOperation is valid
 */
    function _packSigTimeRange(address sigAuthorizer, uint48 validUntil, uint48 validAfter) pure returns (uint256) {
        return uint160(sigAuthorizer) | (uint256(validUntil) << 160) | (uint256(validAfter) << (160 + 48));
    }

/**
 * helper to pack the return value for validateUserOp, when not using an aggregator
 * @param sigFailed - true for signature failure, false for success
 * @param validUntil last timestamp this UserOperation is valid (or zero for infinite)
 * @param validAfter first timestamp this UserOperation is valid
 */
    function _packSigTimeRange(bool sigFailed, uint48 validUntil, uint48 validAfter) pure returns (uint256) {
        return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << (160 + 48));
    }
