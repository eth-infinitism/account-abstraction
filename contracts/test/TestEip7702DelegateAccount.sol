pragma solidity ^0.8.28;
// SPDX-License-Identifier: GPL-3.0

import  "../accounts/Simple7702Account.sol";

contract TestEip7702DelegateAccount is Simple7702Account {

    bool public testInitCalled;

    function testInit() public {
        testInitCalled = true;
    }

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        if (userOp.initCode.length > 20) {
            require(testInitCalled, "testInit not called");
        }
        return Simple7702Account._validateSignature(userOp, userOpHash);
    }
}
