
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISenderCreator {
    /**
     * @dev Creates a new sender contract.
     * @return sender Address of the newly created sender contract.
     */
    function createSender(bytes calldata initCode) external returns (address sender);

    // call initCode to initialize an EIP-7702 account
    function initEip7702Sender(address sender, bytes calldata initCode) external;
}
