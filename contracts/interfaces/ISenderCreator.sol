
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISenderCreator {
    /**
     * @dev Creates a new sender contract.
     * @return sender Address of the newly created sender contract.
     */
    function createSender(bytes calldata initCode) external returns (address sender);

    // Call initCode to initialize an EIP-7702 account
    // Note: Can be called multiple times as long as an appropriate initCode is supplied
    function initEip7702Sender(address sender, bytes calldata initCode) external;
}
