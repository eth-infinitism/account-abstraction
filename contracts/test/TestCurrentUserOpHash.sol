// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "../interfaces/IEntryPoint.sol";

// A test "receiver" contract for testing the "getCurrentUserOpHash" function.
contract TestCurrentUserOpHash {
    uint256 private counter;

    event GotCurrentUserOpHash(uint256 count, bytes32 userOpHash);

    function getCurrentUserOpHashFromEntryPoint(IEntryPoint entryPoint) public {
        bytes32 userOpHash = entryPoint.getCurrentUserOpHash();
        emit GotCurrentUserOpHash(counter++, userOpHash);
    }
}
