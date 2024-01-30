// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;
import "../interfaces/IAccount.sol";
import "../interfaces/IEntryPoint.sol";
import "../core/UserOperationLib.sol";
import "../core/Helpers.sol";

contract MaliciousAccount is IAccount {
    IEntryPoint private ep;
    constructor(IEntryPoint _ep) payable {
        ep = _ep;
    }
    function validateUserOp(PackedUserOperation calldata userOp, bytes32, uint256 missingAccountFunds)
    external returns (uint256 validationData) {
        ep.depositTo{value : missingAccountFunds}(address(this));
        // Now calculate basefee per EntryPoint.getUserOpGasPrice() and compare it to the basefe we pass off-chain in the signature
        uint256 externalBaseFee = abi.decode(userOp.signature, (uint256));
        (uint256 verificationGasLimit, uint256 callGasLimit) = UserOperationLib.unpackAccountGasLimits(userOp.accountGasLimits);
        uint256 requiredGas = verificationGasLimit +
                            callGasLimit +
                            userOp.preVerificationGas;
        uint256 gasPrice = missingAccountFunds / requiredGas;
        uint256 basefee = gasPrice - userOp.maxPriorityFeePerGas;
        require (basefee == externalBaseFee, "Revert after first validation");
        return SIG_VALIDATION_SUCCESS;
    }
}
