// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;
/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */

import "../interfaces/ISenderCreator.sol";
import "../interfaces/IEntryPoint.sol";
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

    uint256 private constant REVERT_REASON_MAX_LEN = 2048;

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
        address factory = address(bytes20(initCode[0 : 20]));

        bytes memory initCallData = initCode[20 :];
        bool success;
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

    /// @inheritdoc ISenderCreator
    function initEip7702Sender(
        address sender,
        bytes memory initCallData
    ) external {
        require(msg.sender == entryPoint, "AA97 should call from EntryPoint");
        bool success;
        assembly ("memory-safe") {
            success := call(
                gas(),
                sender,
                0,
                add(initCallData, 0x20),
                mload(initCallData),
                0,
                0
            )
        }
        if (!success) {
            bytes memory result = Exec.getReturnData(REVERT_REASON_MAX_LEN);
            revert IEntryPoint.FailedOpWithRevert(0, "AA13 EIP7702 sender init failed", result);
        }
    }
}
