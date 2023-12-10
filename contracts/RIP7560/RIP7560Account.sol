// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

contract RIP7560Account {
    uint256 public accCounter = 0;

    event Funded(string id, uint256 amount);

    event AccountValidationEvent(string name, uint256 counter);
    event AccountExecutionEvent(string name, uint256 counter, bytes data);

    function validateTransaction(
        uint256 version,
        bytes32 txHash,
        bytes calldata transaction) external returns (uint256 validationData) {
        emit AccountValidationEvent("the-account", accCounter);
        validationData = 0;
        accCounter++;
    }

    function anyExecutionFunction() external {
        emit AccountExecutionEvent("the-account", accCounter, msg.data);
    }

    receive() external payable {
        emit Funded("account", msg.value);
    }

//    fallback(bytes calldata) external returns (bytes memory) {
//        accCounter++;
//        emit AccountEvent("account", string(msg.data));
//        return "account-returned-data-here";
//    }
}
