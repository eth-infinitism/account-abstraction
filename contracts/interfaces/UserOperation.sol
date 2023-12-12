// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/**
 * User Operation struct
 * @param sender                - The sender account of this request.
 * @param nonce                 - Unique value the sender uses to verify it is not a replay.
 * @param initCode              - If set, the account contract will be created by this constructor/
 * @param callData              - The method call to execute on this account.
 * @param callGasLimit          - The gas limit passed to the callData method call.
 * @param verificationGasLimit  - Gas used for validateUserOp and validatePaymasterUserOp.
 * @param preVerificationGas    - Gas not calculated by the handleOps method, but added to the gas paid.
 *                                Covers batch overhead.
 * @param maxFeePerGas          - Same as EIP-1559 gas parameter.
 * @param maxPriorityFeePerGas  - Same as EIP-1559 gas parameter.
 * @param paymasterAndData      - If set, this field holds the paymaster address and paymaster-specific data.
 *                                The paymaster will pay for the transaction instead of the sender.
 * @param signature             - Sender-verified signature over the entire request, the EntryPoint address and the chain ID.
 */
struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}
