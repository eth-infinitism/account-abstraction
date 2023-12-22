// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./RIP7560TransactionType4.sol";

contract RIP7560Account {
    uint256 public accCounter = 0;

    event Funded(string id, uint256 amount);

    event AccountValidationEvent(string name, uint256 counter, uint256 builderFee);
    event AccountExecutionEvent(string name, uint256 counter, bytes data);

    constructor() {
    }

    function validateTransaction(
        uint256 version,
        bytes32 txHash,
        bytes calldata transaction) external returns (uint256 validationData) {
        TransactionType4 memory txStruct = abi.decode(transaction, (TransactionType4));
        emit AccountValidationEvent("the-account", accCounter, txStruct.builderFee);
        validationData = 0;
        accCounter++;
        return uint256(bytes32(abi.encodePacked(bytes4(0xbf45c166), uint64(block.timestamp), uint64(block.timestamp + 10000))));
    }

    function anyExecutionFunction() external {
        emit AccountExecutionEvent("the-account", accCounter, msg.data);
    }

    receive() external payable {
        emit Funded("account", msg.value);
    }

    fallback(bytes calldata) external returns (bytes memory) {
//        accCounter++;
//        emit AccountEvent("account", string(msg.data));
        return "account-returned-data-here";
    }
}
