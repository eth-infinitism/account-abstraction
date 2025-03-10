// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "../interfaces/PackedUserOperation.sol";
import "../core/Eip7702Support.sol";

contract TestUtil {
    using UserOperationLib for PackedUserOperation;

    function encodeUserOp(PackedUserOperation calldata op) external pure returns (bytes memory){
        return op.encode(0);
    }

    function isEip7702InitCode(bytes calldata initCode) external pure returns (bool) {
        return Eip7702Support._isEip7702InitCode(initCode);
    }
}
