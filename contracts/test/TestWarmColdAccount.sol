// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;
/* solhint-disable no-inline-assembly */

import "../interfaces/IAggregatedAccount.sol";
import "../interfaces/IEntryPoint.sol";


contract TestWarmColdAccount is IAggregatedAccount {
    IEntryPoint private ep;
    uint public state = 1;
    constructor(IEntryPoint _ep) payable {
        ep = _ep;
    }

    function validateUserOp(UserOperation calldata userOp, bytes32, address, uint256 missingAccountFunds)
    external override returns (uint256 sigTimeRange) {
        ep.depositTo{value : missingAccountFunds}(address(this));
        if (userOp.nonce == 1) {
            this.touchStorage{gas: 1000}();
        } else if (userOp.nonce == 2) {
            address paymaster = address(bytes20(userOp.paymasterAndData[: 20]));
            this.touchPaymaster{gas: 1000}(paymaster);
        }
        return 0;
    }

    function getAggregator() external view returns (address) {
        touchStorage();
        return address(0);
    }

    function touchStorage() public view returns (uint) {
        return state;
    }

    function touchPaymaster(address paymaster) public view returns (uint) {
        return paymaster.code.length;
    }
}
