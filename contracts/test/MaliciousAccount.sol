// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;
import "../interfaces/IAccount.sol";
import "../interfaces/IEntryPoint.sol";
import "../core/EntryPoint.sol";

contract MaliciousAccount is IAccount {
    IEntryPoint private ep;
    constructor(IEntryPoint _ep) payable {
        ep = _ep;
    }
    function validateUserOp(UserOperation calldata userOp, bytes32, uint256 missingAccountFunds)
    external returns (uint256 validationData) {
        ep.depositTo{value : missingAccountFunds}(address(this));
        // Now calculate basefee per EntryPoint.getUserOpGasPrice() and compare it to the basefe we pass off-chain in the signature
        uint256 externalBaseFee = abi.decode(userOp.signature, (uint256));
        uint256 requiredGas = userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas;
        uint256 gasPrice = missingAccountFunds / requiredGas;
        uint256 basefee = gasPrice - userOp.maxPriorityFeePerGas;
        require (basefee == externalBaseFee, "Revert after first validation");
        return 0;
    }
}
