// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "hardhat/console.sol";

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

    struct UserOperation {

        address target;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        uint callGas;
        uint verificationGas;
        uint maxFeePerGas;
        uint maxPriorityFeePerGas;
        address paymaster;
        bytes paymasterData;
        bytes signature;
    }

library UserOperationLib {

    //relayer/miner might submit the TX with higher priorityFee, but the user should not
    // pay above what he signed for.
    function gasPrice(UserOperation calldata userOp) internal view returns (uint) {
        return min(userOp.maxFeePerGas, min(userOp.maxPriorityFeePerGas + block.basefee, tx.gasprice));
    }

    function requiredGas(UserOperation memory userOp) internal pure returns (uint) {
        return userOp.callGas + userOp.verificationGas;
    }

    //TODO: compiler crashes when changing param to "calldata"
    function requiredPreFund(UserOperation calldata userOp) internal view returns (uint prefund) {
        return requiredGas(userOp) * gasPrice(userOp);
    }

    function hasPaymaster(UserOperation memory userOp) internal pure returns (bool) {
        return userOp.paymaster != address(0);
    }

    function pack(UserOperation memory userOp) internal pure returns (bytes memory) {
        //TODO: eip712-style ?
        return abi.encode(
            userOp.target,
            userOp.nonce,
            userOp.initCode,
            userOp.callData,
            userOp.callGas,
            userOp.verificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            userOp.paymaster,
            userOp.paymasterData
        );
    }

    function hash(UserOperation memory userOp) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",
            keccak256(pack(userOp))));
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }
}
