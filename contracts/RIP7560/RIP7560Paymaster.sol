// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

contract RIP7560Paymaster {
    uint256 public pmCounter = 0;
    event PaymasterEvent(string id, string message);

    fallback() external {
        pmCounter++;
        emit PaymasterEvent("paymaster", string(msg.data));
        return "paymaster-returned-data-here";
    }
}
