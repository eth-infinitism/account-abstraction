// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

contract RIP7560Paymaster {
    uint256 public pmCounter = 0;
    bool public revertValidation;

    event PaymasterValidationEvent(string name, uint256 counter);
    event PaymasterPostTxEvent(string name, uint256 counter, bytes context);

    constructor(bool _revertValidation) {
        revertValidation = _revertValidation;
    }

    function validatePaymasterTransaction(
        uint256 version,
        bytes32 txHash,
        bytes calldata transaction)
    external
    returns (
        bytes memory context,
        uint256 validationData
    ){
        emit PaymasterValidationEvent("the-paymaster", pmCounter);
        context = abi.encodePacked("context here", pmCounter);
        validationData = 0;
        pmCounter++;
    }

    function postPaymasterTransaction(
        bool success,
        uint256 actualGasCost,
        bytes calldata context
    ) external {
        emit PaymasterPostTxEvent("the-paymaster", pmCounter, context);
    }

//    fallback(bytes calldata) external returns (bytes memory) {
//        if (revertValidation){
//            revert("paymaster-reverted-here");
//        }
//        pmCounter++;
//        emit PaymasterEvent("paymaster", string(msg.data));
//        return "paymaster-returned-data-here";
//    }
}
