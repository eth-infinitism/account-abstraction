// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
    struct UserOperation {

        //    struct OpData {
        address target;
        uint256 nonce;
        bytes callData;
        uint64 callGas;
        //    }

        //    struct {
        uint maxFeePerGas;
        uint maxPriorityFeePerGas;

        address paymaster;
        //    }

        address signer;
        bytes signature;
    }

library UserOperationLib {
    //TODO: compiler crashes when changing param to "calldata"
    function requiredPreFund(UserOperation memory userOp) internal view returns (uint) {
        //TODO: does paymaster has extra gas?
        return userOp.callGas * userOp.maxFeePerGas;
    }

    function clientPrePay(UserOperation calldata userOp) internal view returns (uint){
        if (hasPaymaster(userOp)) {
            return 0;
        }
        return requiredPreFund(userOp);
    }

    function hasPaymaster(UserOperation memory userOp) internal view returns (bool) {
        return userOp.paymaster != address(0);
    }

    function pack(UserOperation memory userOp) internal view returns (bytes memory) {
        //TODO: eip712-style ?
        return abi.encode(
            userOp.target,
            userOp.nonce,
            userOp.callData,
            userOp.callGas,
            userOp.maxFeePerGas,
            userOp.maxPriorityFeePerGas,
            userOp.paymaster
        );
    }

    function hash(UserOperation memory userOp) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",
            keccak256(pack(userOp))));
    }
}
