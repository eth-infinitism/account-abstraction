// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../UserOperation.sol";
import "../IWallet.sol";

contract TestUtil {
    using UserOperationLib for UserOperation;

    function packUserOp(UserOperation calldata op) external pure returns (bytes memory){
        return op.pack();
    }

    function prefund(UserOperation calldata op) public view returns (uint) {
        return op.requiredPreFund();
    }

}