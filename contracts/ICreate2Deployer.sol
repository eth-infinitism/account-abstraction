// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/**
 * create2-based deployer (eip-2470)
 */
interface ICreate2Deployer {
    function deploy(bytes memory initCode, bytes32 salt) external returns (address);
}

