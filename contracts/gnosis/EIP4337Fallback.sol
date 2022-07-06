//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

import "@gnosis.pm/safe-contracts/contracts/handler/DefaultCallbackHandler.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "../IWallet.sol";

contract EIP4337Fallback is DefaultCallbackHandler, IWallet {
    address immutable public eip4337Module;
    constructor(address _eip4337Module) {
        eip4337Module = _eip4337Module;
    }

    /**
     * handler is called from the Safe. delegate actual work to EIP4337Module
     */
    function validateUserOp(UserOperation calldata, bytes32, uint256) external {
        //delegate entire msg.data (including the appended "msg.sender") to the EIP4337Module
        // will work only for GnosisSafe contracts
        GnosisSafe safe = GnosisSafe(payable(msg.sender));
        (bool success, bytes memory ret) = safe.execTransactionFromModuleReturnData(eip4337Module, 0, msg.data, Enum.Operation.DelegateCall);
        if (!success) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

}
