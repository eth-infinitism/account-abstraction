//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

import "@gnosis.pm/safe-contracts/contracts/handler/DefaultCallbackHandler.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "../IWallet.sol";
import "../UserOperation.sol";

contract EIP4337Fallback is DefaultCallbackHandler, IWallet {
    address public immutable entryPoint;
    address immutable public eip4337Module;
    constructor(address _entryPoint, address _eip4337Module) {
        entryPoint = _entryPoint;
        eip4337Module = _eip4337Module;
    }

    /**
     * handler is called from the Safe.
     * - msg.sender == safe
     * - calldata[:40] == entryPoint
     * however, handler itself is global, so it can't
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, uint256 missingWalletFunds) external {
        address _msgSender = address(bytes20(msg.data[msg.data.length - 20 :]));
        require(_msgSender == address(entryPoint));
        //this call doesn't validate msg.sender to be a safe, because it can't.
        // the Safe itself should only accept this call from the Fallback handler, which is defined as a module.
        (bool success, bytes memory ret) = GnosisSafe(payable(msg.sender)).execTransactionFromModuleReturnData(eip4337Module, 0,
            abi.encodeCall(IWallet.validateUserOp, (userOp, requestId, missingWalletFunds)), Enum.Operation.DelegateCall);
        if (!success) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
