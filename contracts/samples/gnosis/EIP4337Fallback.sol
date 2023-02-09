//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

/* solhint-disable no-inline-assembly */

import "@gnosis.pm/safe-contracts/contracts/handler/DefaultCallbackHandler.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IAccount.sol";
import "./EIP4337Manager.sol";

using ECDSA for bytes32;

contract EIP4337Fallback is DefaultCallbackHandler, IAccount, IERC1271 {
    address immutable public eip4337manager;
    constructor(address _eip4337manager) {
        eip4337manager = _eip4337manager;
    }

    /**
     * handler is called from the Safe. delegate actual work to EIP4337Manager
     */
    function validateUserOp(UserOperation calldata, bytes32, address, uint256) override external returns (uint256 sigTimeRange){
        //delegate entire msg.data (including the appended "msg.sender") to the EIP4337Manager
        // will work only for GnosisSafe contracts
        GnosisSafe safe = GnosisSafe(payable(msg.sender));
        (bool success, bytes memory ret) = safe.execTransactionFromModuleReturnData(eip4337manager, 0, msg.data, Enum.Operation.DelegateCall);
        if (!success) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return abi.decode(ret, (uint256));
    }

    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) external override view returns (bytes4) {
        bytes32 hash = _hash.toEthSignedMessageHash();
        address recovered = hash.recover(_signature);

        GnosisSafe safe = GnosisSafe(payable(address(msg.sender)));

        // Validate signatures
        if (safe.isOwner(recovered)) {
            return 0x1626ba7e;
        } else {
            return 0xffffffff;
        }
    }
}
