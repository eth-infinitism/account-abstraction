// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./SimpleWallet.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
/**
 * A sampler deployer contract for SimpleWallet
 * A UserOperations "initCode" holds the address of the deployer, and a method call (to deployWallet, in this sample deployer).
 * The deployer's deployWallet returns the target wallet address even if it is already installed.
 * This way, the entryPoint.getSenderAddress() can be called either before or after the wallet is created.
 */
contract SimpleWalletDeployer {

    /**
     * create a wallet, and return its address.
     * returns the address even if the wallet is already deployed.
     * Note that during UserOperation execution, this method is called only if the wallet is not deployed.
     * This method returns an existing wallet address so that entryPoint.getSenderAddress() would work even after wallet creation
     */
    function deployWallet(IEntryPoint entryPoint, address owner, uint salt) public returns (SimpleWallet ret) {
        address addr = getAddress(entryPoint, owner, salt);
        uint codeSize = addr.code.length;
        if (codeSize > 0) {
            return SimpleWallet(payable(addr));
        }
        ret = new SimpleWallet{salt : bytes32(salt)}(entryPoint, owner);
    }

    /**
     * calculate the counterfactual address of this wallet as it would be returned by deployWallet()
     */
    function getAddress(IEntryPoint entryPoint, address owner, uint salt) public view returns (address) {
        return Create2.computeAddress(bytes32(salt), keccak256(abi.encodePacked(
                type(SimpleWallet).creationCode,
                abi.encode(entryPoint, owner))
            ));
    }
}
