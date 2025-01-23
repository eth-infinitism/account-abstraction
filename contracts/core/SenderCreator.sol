// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "../interfaces/ISenderCreator.sol";
import "../utils/Exec.sol";

/**
 * Helper contract for EntryPoint, to call userOp.initCode from a "neutral" address,
 * which is explicitly not the entryPoint itself.
 */
contract SenderCreator is ISenderCreator {
    address public immutable entryPoint;

    constructor(){
        entryPoint = msg.sender;
    }

    /**
     * Call the "initCode" factory to create and return the sender account address.
     * @param initCode - The initCode value from a UserOp. contains 20 bytes of factory address,
     *                   followed by calldata.
     * @return sender  - The returned address of the created account, or zero address on failure.
     */
    function createSender(
        bytes calldata initCode
    ) external returns (address sender) {
        require(msg.sender == entryPoint, "AA97 should call from EntryPoint");
        address factory = address(bytes20(initCode[0:20]));

        bytes memory initCallData = initCode[20:];
        bool success;
        /* solhint-disable no-inline-assembly */
        assembly ("memory-safe") {
            success := call(
                gas(),
                factory,
                0,
                add(initCallData, 0x20),
                mload(initCallData),
                0,
                32
            )
            if success {
                sender := mload(0)
            }
        }
    }

    // use initCode to initialize an EIP-7702 account
    // caller (EntryPoint) already verified it is an EIP-7702 account.
    function initEip7702Sender(
        address sender,
        bytes calldata initCode
    ) external {
        require(msg.sender == entryPoint, "AA97 should call from EntryPoint");
        bytes memory initCallData = initCode[20 :];
        // solhint-disable-next-line avoid-low-level-calls
        bool success = Exec.call(sender, 0, initCallData, gasleft());
        require(success, "AA13 EIP7702 sender init failed");
    }
}
