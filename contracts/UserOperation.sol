// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

struct OpData {
    address target;
    uint256 nonce;
    bytes callData;
    uint64 callGas;
}

struct PayData {
    uint maxFeePerGas;
    uint maxPriorityFeePerGas;

    address paymaster;
}

struct UserOperation {
    OpData opData;
    PayData payData;
    address signer;
    bytes signature;
}

library UserOperationLib {
    //TODO: compiler crashes when changing param to "calldata"
    function requiredPreFund(UserOperation memory userOp) internal pure returns (uint) {
        //TODO: does paymaster has extra gas?
        return userOp.opData.callGas * userOp.payData.maxFeePerGas;
    }

    function clientPrePay(UserOperation calldata userOp) internal pure returns (uint){
        if (hasPaymaster(userOp))
            return 0;
        return requiredPreFund(userOp);
    }

    function hasPaymaster(UserOperation memory userOp) internal pure returns (bool) {
        return userOp.payData.paymaster != address(0);
    }

    function hash(UserOperation memory userOp) internal pure returns (bytes32) {
        //TODO: pack entire structure
        return keccak256(abi.encodePacked(
                userOp.opData.target,
                userOp.opData.nonce,
                keccak256(userOp.opData.callData),
                userOp.opData.callGas
            ));
    }
}
