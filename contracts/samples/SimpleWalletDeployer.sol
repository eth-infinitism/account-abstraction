// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./SimpleWallet.sol";

/**
 * A sampler deployer contract for SimpleWallet
 * A UserOperations "initCode" holds the address of the deployer, and a method call (to deployWallet, in this sample deployer).
 * The deployer's deployWallet returns the target wallet address even if it is already installed.
 * This way, the entryPoint.getSenderAddress() can be called either before or after the wallet is created.
 */
contract SimpleWalletDeployer {

    /**
     * create a wallet, and return its address.
     * return the address even if the wallet is already deployed.
     */
    function deployWallet(IEntryPoint entryPoint, address owner, uint salt) public returns (SimpleWallet ret) {
        address addr = getAddress(entryPoint, owner, salt);
        uint codeSize;
        /* solhint-disable no-inline-assembly */
        assembly {codeSize := extcodesize(addr)}
        if (codeSize > 0) {
            return SimpleWallet(payable(addr));
        }
        ret = new SimpleWallet{salt : bytes32(salt)}(entryPoint, owner);
    }

    /**
     */
    function getAddress(IEntryPoint entryPoint, address owner, uint salt) public view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(abi.encodePacked(
                    type(SimpleWallet).creationCode,
                    abi.encode(entryPoint, owner)
                )))))));
    }
}
