// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;
/* solhint-disable no-inline-assembly */

import "../samples/SimpleAccount.sol";
contract TestRevertAccount is IAccount {
    IEntryPoint private ep;
    constructor(IEntryPoint _ep) payable {
        ep = _ep;
    }

    function validateUserOp(UserOperation calldata, bytes32, address, uint256 missingAccountFunds)
    external override returns (uint256 sigTimeRange) {
        ep.depositTo{value : missingAccountFunds}(address(this));
        return 0;
    }

    function revertLong(uint256 length) public pure{
        assembly {
            revert(0, length)
        }
    }
}
