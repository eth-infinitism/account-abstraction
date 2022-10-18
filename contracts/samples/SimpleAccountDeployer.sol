// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./SimpleAccount.sol";

/**
 * a sampler deployer contract for SimpleAccount
 * the "initCode" for a wallet hold its address and a method call (deployAccount) with parameters, not actual constructor code.
 */
contract SimpleAccountDeployer {

    function deployAccount(IEntryPoint entryPoint, address owner, uint salt) public returns (SimpleAccount) {
        return new SimpleAccount{salt : bytes32(salt)}(entryPoint, owner);
    }
}
