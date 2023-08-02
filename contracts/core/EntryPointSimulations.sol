// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */

import "./EntryPoint.sol";
import "../interfaces/IEntryPointSimulations.sol";

/*
 * This contract inherits the EntryPoint and extends it with the view-only methods that are executed by
 * the bundler in order to check UserOperation validity and estimate its gas consumption.
 */
contract EntryPointSimulations is EntryPoint, IEntryPointSimulations {
    // solhint-disable-next-line var-name-mixedcase
    AggregatorStakeInfo private NOT_AGGREGATED = AggregatorStakeInfo(address(0), StakeInfo(0, 0));

    /// @inheritdoc IEntryPointSimulations
    function simulateValidation(
        UserOperation calldata userOp
    )
    external
    returns (
        ValidationResult memory
    ){
        UserOpInfo memory outOpInfo;

        _simulationOnlyValidations(userOp);
        (
            uint256 validationData,
            uint256 paymasterValidationData
        ) = _validatePrepayment(0, userOp, outOpInfo);
        StakeInfo memory paymasterInfo = _getStakeInfo(
            outOpInfo.mUserOp.paymaster
        );
        StakeInfo memory senderInfo = _getStakeInfo(outOpInfo.mUserOp.sender);
        StakeInfo memory factoryInfo;
        {
            bytes calldata initCode = userOp.initCode;
            address factory = initCode.length >= 20
                ? address(bytes20(initCode[0 : 20]))
                : address(0);
            factoryInfo = _getStakeInfo(factory);
        }

        ValidationData memory data = _intersectTimeRange(
            validationData,
            paymasterValidationData
        );
        address aggregator = data.aggregator;
        bool sigFailed = aggregator == address(1);
        ReturnInfo memory returnInfo = ReturnInfo(
            outOpInfo.preOpGas,
            outOpInfo.prefund,
            sigFailed,
            data.validAfter,
            data.validUntil,
            getMemoryBytesFromOffset(outOpInfo.contextOffset)
        );

        if (aggregator != address(0) && aggregator != address(1)) {
            AggregatorStakeInfo memory aggregatorInfo = AggregatorStakeInfo(
                aggregator,
                _getStakeInfo(aggregator)
            );
            return ValidationResult(
                returnInfo,
                senderInfo,
                factoryInfo,
                paymasterInfo,
                aggregatorInfo
            );
        }
        return ValidationResult(
            returnInfo,
            senderInfo,
            factoryInfo,
            paymasterInfo,
            NOT_AGGREGATED
        );
    }

    /// @inheritdoc IEntryPointSimulations
    function simulateHandleOp(
        UserOperation calldata op,
        address target,
        bytes calldata targetCallData
    )
    external
    returns (
        ExecutionResult memory
    ){
        UserOpInfo memory opInfo;
        _simulationOnlyValidations(op);
        (
            uint256 validationData,
            uint256 paymasterValidationData
        ) = _validatePrepayment(0, op, opInfo);
        ValidationData memory data = _intersectTimeRange(
            validationData,
            paymasterValidationData
        );

        numberMarker();
        uint256 paid = _executeUserOp(0, op, opInfo);
        numberMarker();
        bool targetSuccess;
        bytes memory targetResult;
        if (target != address(0)) {
            (targetSuccess, targetResult) = target.call(targetCallData);
        }
        return ExecutionResult(
            opInfo.preOpGas,
            paid,
            data.validAfter,
            data.validUntil,
            targetSuccess,
            targetResult
        );
    }
}
