// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

struct TransactionType4 {
    address sender;
    uint256 nonce;
    uint256 validationGasLimit;
    uint256 paymasterGasLimit;
    uint256 callGasLimit;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    uint256 builderFee;
    bytes paymasterData;
    bytes deployerData;
    bytes callData;
    bytes signature;
}
