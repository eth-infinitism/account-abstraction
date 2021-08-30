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
    unchecked {
        return min(userOp.maxFeePerGas, userOp.maxPriorityFeePerGas + block.basefee);
    }
    }

    function requiredGas(UserOperation calldata userOp) internal pure returns (uint) {
    unchecked {
        return userOp.callGas + userOp.verificationGas;
    }
    }

    //TODO: compiler crashes when changing param to "calldata"
    function requiredPreFund(UserOperation calldata userOp) internal view returns (uint prefund) {
        return requiredGas(userOp) * gasPrice(userOp);
    }

    function hasPaymaster(UserOperation calldata userOp) internal pure returns (bool) {
        return userOp.paymaster != address(0);
    }

    function pack(UserOperation memory userOp) internal pure returns (bytes memory) {
        //TODO: eip712-style ?
        return abi.encode(
            userOp.target,
            userOp.nonce,
            keccak256(userOp.initCode),
            keccak256(userOp.callData),
            userOp.callGas,
            userOp.verificationGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            userOp.paymaster,
            keccak256(userOp.paymasterData)
        );
    }

    function hash(UserOperation calldata userOp) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",
            keccak256(pack(userOp))));
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }
}
