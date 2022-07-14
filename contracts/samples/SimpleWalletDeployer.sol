// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./SimpleWallet.sol";

/**
 * a sampler deployer contract for SimpleWallet
 * the "initCode" for a wallet hold its address and a method call (deployWallet) with parameters, not actual constructor code.
 */
contract SimpleWalletDeployer {

    function deployWallet(EntryPoint entryPoint, address owner, uint salt) public returns (SimpleWallet) {
        return new SimpleWallet{salt : bytes32(salt)}(entryPoint, owner);
    }

    //calculate the CREATE2 address of this wallet:
    function getWalletAddress(EntryPoint entryPoint, address owner, uint salt) public view returns (address) {
        bytes memory ctr = abi.encodePacked(type(SimpleWallet).creationCode, uint256(uint160(address(entryPoint))), uint256(uint160(owner)));
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(ctr)
            )
        );

        // NOTE: cast last 20 bytes of hash to address
        return address(uint160(uint256(hash)));
    }
}
