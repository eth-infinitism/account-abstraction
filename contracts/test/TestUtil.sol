// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../UserOperation.sol";

contract TestUtil {
    using UserOperationLib for UserOperation;

    function packUserOp(UserOperation calldata op) external pure returns (bytes memory){
        return op.pack();
    }

    function prefund(UserOperation calldata op) public view returns (uint256) {
        return op.requiredPreFund();
    }
}
