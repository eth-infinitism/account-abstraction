// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.5;

import "./PackedUserOperation.sol";
import "./IEntryPoint.sol";

interface IEntryPointSimulations is IEntryPoint {
    // Return value of simulateHandleOp.
    struct ExecutionResult {
        uint256 preOpGas;
        uint256 paid;
        uint256 accountValidationData;
        uint256 paymasterValidationData;
        bool targetSuccess;
        bytes targetResult;
    }

    /**
     * Successful result from simulateValidation.
     * If the account returns a signature aggregator the "aggregatorInfo" struct is filled in as well.
     * @param returnInfo     Gas and time-range returned values
     * @param senderInfo     Stake information about the sender
     * @param factoryInfo    Stake information about the factory (if any)
     * @param paymasterInfo  Stake information about the paymaster (if any)
     * @param aggregatorInfo Signature aggregation info (if the account requires signature aggregator)
     *                       Bundler MUST use it to verify the signature, or reject the UserOperation.
     */
    struct ValidationResult {
        ReturnInfo returnInfo;
        StakeInfo senderInfo;
        StakeInfo factoryInfo;
        StakeInfo paymasterInfo;
        AggregatorStakeInfo aggregatorInfo;
    }

    /**
     * Simulate a call to account.validateUserOp and paymaster.validatePaymasterUserOp.
     * @dev The node must also verify it doesn't use banned opcodes, and that it doesn't reference storage
     *      outside the account's data.
     * @param userOp - The user operation to validate.
     * @return the validation result structure
     */
    function simulateValidation(
        PackedUserOperation calldata userOp
    )
    external
    returns (
        ValidationResult memory
    );

    /**
     * Simulate full execution of a UserOperation (including both validation and target execution)
     * It performs full validation of the UserOperation, but ignores signature error.
     * An optional target address is called after the userop succeeds,
     * and its value is returned (before the entire call is reverted).
     * Note that in order to collect the the success/failure of the target call, it must be executed
     * with trace enabled to track the emitted events.
     * @param op The UserOperation to simulate.
     * @param target         - If nonzero, a target address to call after userop simulation. If called,
     *                         the targetSuccess and targetResult are set to the return from that call.
     * @param targetCallData - CallData to pass to target address.
     * @return the execution result structure
     */
    function simulateHandleOp(
        PackedUserOperation calldata op,
        address target,
        bytes calldata targetCallData
    )
    external
    returns (
        ExecutionResult memory
    );
}
