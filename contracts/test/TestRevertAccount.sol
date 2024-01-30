// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.23;
/* solhint-disable no-inline-assembly */

import "../samples/SimpleAccount.sol";
contract TestRevertAccount is IAccount {
    IEntryPoint private ep;
    constructor(IEntryPoint _ep) payable {
        ep = _ep;
    }

    function validateUserOp(PackedUserOperation calldata, bytes32, uint256 missingAccountFunds)
    external override returns (uint256 validationData) {
        ep.depositTo{value : missingAccountFunds}(address(this));
        return SIG_VALIDATION_SUCCESS;
    }

    function revertLong(uint256 length) public pure{
        assembly {
            revert(0, length)
        }
    }
}
