// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./SimpleWallet.sol";

/**
 * a sampler deployer contract for SimpleWallet
 * the "initCode" for a wallet hold its address and a method call (deployWallet) with parameters, not actual constructor code.
 */
contract SimpleWalletDeployer {

    function deployWallet(IEntryPoint entryPoint, address owner, uint salt) public returns (SimpleWallet) {
        return new SimpleWallet{salt : bytes32(salt)}(entryPoint, owner);
    }
}
