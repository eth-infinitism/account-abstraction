// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * User Operation struct
 * @param sender                - The sender account of this request.
 * @param nonce                 - Unique value the sender uses to verify it is not a replay.
 * @param initCode              - If set, the account contract will be created by this constructor
 * @param callData              - The method call to execute on this account.
 * @param accountGasLimits      - Packed gas limits for validateUserOp and gas limit passed to the callData method call.
 * @param preVerificationGas    - Gas not calculated by the handleOps method, but added to the gas paid.
 *                                Covers batch overhead.
 * @param gasFees               - packed gas fields maxPriorityFeePerGas and maxFeePerGas - Same as EIP-1559 gas parameters.
 * @param paymasterAndData      - If set, this field holds the paymaster address, verification gas limit, postOp gas limit and paymaster-specific extra data
 *                                The paymaster will pay for the transaction instead of the sender.
 * @param signature             - Sender-verified signature over the entire request, the EntryPoint address and the chain ID.
 *
 *
 * Field layout (enforced on-chain by EntryPoint):
 * - sender: must already be deployed, or be the address that `initCode` will deploy; for EIP-7702 onboarding, `initCode = 0x7702 || optionalPayload`
 *   and `sender.code` must begin `0xef0100 || delegate`.
 * - nonce = uint192(key) || uint64(sequence); EntryPoint tracks sequential values of `sequence` separately for each `key` value.
 * - initCode:
 *     * non-7702: `initCode = factory(20) || factoryCalldata`; the factory must return `sender` and deploy code.
 *     * The `initCode` will be ignored if the `sender` is already deployed.
 *     * 7702: `0x7702` (magic prefix), optionally padded to 20 bytes and followed by the actual `initializationCode` data. This optional payload is executed on `sender` to finalise delegate setup.
 * - callData: executed verbatim; if it starts with `IAccountExecute.executeUserOp.selector` (0x8dd7712f), EntryPoint wraps and forwards `(userOp, userOpHash)`.
 * - accountGasLimits =`uint128(verificationGasLimit) || uint128(callGasLimit)`
 * - gasFees = `uint128(maxPriorityFeePerGas) || uint128(maxFeePerGas)`
 * - paymasterAndData (if non-empty) = `paymaster(20) || verificationGasLimit(16) || postOpGasLimit(16) || paymasterData`
 *     * an optional paymasterSignature may be added by appending:
 *       `paymasterSignature || uint16(paymasterSignature.length) || PAYMASTER_SIG_MAGIC (0x22e325a297439656)`
 * - signature: Used by the account to validate the UserOperation against the `userOpHash`.
 *              The hash covers all UserOperation fields, except `signature` and `paymasterSignature`
 */
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}
