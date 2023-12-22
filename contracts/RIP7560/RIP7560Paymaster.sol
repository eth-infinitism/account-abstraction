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
        bytes memory validationData
    ){
        emit PaymasterValidationEvent("the-paymaster", pmCounter);
        bytes memory context = abi.encodePacked("context here", pmCounter);
        pmCounter++;
        bytes memory ret = abi.encodeWithSelector(bytes4(0xe0e6183a), context, block.timestamp, block.timestamp + 10000);
        uint256 len = ret.length;
        // avoid wrapping return value as a byte array here
        assembly {
            return(add(ret, 0x20), len)
        }
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
