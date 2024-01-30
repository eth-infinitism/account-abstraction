// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.23;
/* solhint-disable no-inline-assembly */

import "../interfaces/IEntryPoint.sol";
import "../interfaces/IAccount.sol";
import "../core/Helpers.sol";

// Using eip-2929 (https://eips.ethereum.org/EIPS/eip-2929) warm/cold storage access gas costs to detect simulation vs execution
// COLD_ACCOUNT_ACCESS_COST == 2600, COLD_SLOAD_COST == 2100, WARM_STORAGE_READ_COST == 100
contract TestWarmColdAccount is IAccount {
    IEntryPoint private ep;
    uint256 public state = 1;
    constructor(IEntryPoint _ep) payable {
        ep = _ep;
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32, uint256 missingAccountFunds)
    external override returns (uint256 validationData) {
        ep.depositTo{value : missingAccountFunds}(address(this));
        if (userOp.nonce == 1) {
            // can only succeed if storage is already warm
            this.touchStorage{gas: 1000}();
        } else if (userOp.nonce == 2) {
            address paymaster = address(bytes20(userOp.paymasterAndData[: 20]));
            // can only succeed if storage is already warm
            this.touchPaymaster{gas: 1000}(paymaster);
        }
        return SIG_VALIDATION_SUCCESS;
    }

    function touchStorage() public view returns (uint256) {
        return state;
    }

    function touchPaymaster(address paymaster) public view returns (uint256) {
        return paymaster.code.length;
    }
}
