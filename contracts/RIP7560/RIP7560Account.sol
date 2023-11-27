// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

contract RIP7560Account {
    uint256 public accCounter = 0;

    event Funded(string id, uint256 amount);
    event AccountEvent(string id, string message);

    receive() external payable {
        emit Funded("account", msg.value);
    }

    fallback() external {
        accCounter++;
        emit AccountEvent("account", string(msg.data));
    }
}
