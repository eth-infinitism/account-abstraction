// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "../UserOperation.sol";
import "../samples/ECDSA.sol";

contract TestUtil {
    using UserOperationLib for UserOperation;

    function packUserOp(UserOperation calldata op) external pure returns (bytes memory){
        return op.pack();
    }

    function prefund(UserOperation calldata op) public view returns (uint256) {
        return op.requiredPreFund();
    }

    // helpers for testing ecrecover2
    // ecrecover2 should be equivalent to "ecrecover()", only not using the "gas" opcode
    function ecdsa_ecrecover2(bytes32 hash, uint8 v, bytes32 r, bytes32 s) public view returns (address signer) {
        return ECDSA.ecrecover2(hash, v, r, s);
    }

    function sol_ecrecover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) public pure returns (address signer) {
        return ecrecover(hash, v, r, s);
    }
}
