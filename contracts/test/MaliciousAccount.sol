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
    function validateUserOp(UserOperation calldata userOp, bytes32, address, uint256 missingAccountFunds)
    external returns (uint256 sigTimeRange) {
        ep.depositTo{value : missingAccountFunds}(address(this));
        // Now calculate basefee per EntryPoint.getUserOpGasPrice() and compare it to the basefe we pass off-chain as nonce
        uint256 requiredGas = userOp.callGasLimit + userOp.verificationGasLimit + userOp.preVerificationGas;
        uint256 gasPrice = missingAccountFunds / requiredGas;
        uint256 basefee = gasPrice - userOp.maxPriorityFeePerGas;
        require (basefee == userOp.nonce, "Revert after first validation");
        return 0;
    }
}
