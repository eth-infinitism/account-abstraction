// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable gas-custom-errors */

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../accounts/SimpleAccount.sol";
import "../interfaces/IAccountExecute.sol";

/**
 * a sample account with execUserOp.
 * Note that this account does nothing special with the userop, just extract
 * call to execute. In theory, such account can reference the signature, the hash, etc.
 */
contract TestExecAccount is SimpleAccount, IAccountExecute {

    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint){
    }

    event Executed(PackedUserOperation userOp, bytes innerCallRet);

    function executeUserOp(PackedUserOperation calldata userOp, bytes32 /*userOpHash*/) external {
        _requireForExecute();

        // read from the userOp.callData, but skip the "magic" prefix (executeUserOp sig),
        // which caused it to call this method.
        bytes calldata innerCall = userOp.callData[4 :];

        bytes memory innerCallRet;
        if (innerCall.length > 0) {
            (address target, bytes memory data) = abi.decode(innerCall, (address, bytes));
            bool success;
            (success, innerCallRet) = target.call(data);
            require(success, "inner call failed");
        }

        emit Executed(userOp, innerCallRet);
    }
}

