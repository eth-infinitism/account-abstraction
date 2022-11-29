// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./SimpleAccount.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
/**
 * A sampler deployer contract for SimpleAccount
 * A UserOperations "initCode" holds the address of the deployer, and a method call (to deployAccount, in this sample deployer).
 * The deployer's deployAccount returns the target account address even if it is already installed.
 * This way, the entryPoint.getSenderAddress() can be called either before or after the account is created.
 */
contract SimpleAccountDeployer {

    /**
     * create an account, and return its address.
     * returns the address even if the account is already deployed.
     * Note that during UserOperation execution, this method is called only if the account is not deployed.
     * This method returns an existing account address so that entryPoint.getSenderAddress() would work even after account creation
     */
    function deployAccount(IEntryPoint entryPoint, address owner, uint salt) public returns (SimpleAccount ret) {
        address addr = getAddress(entryPoint, owner, salt);
        uint codeSize = addr.code.length;
        if (codeSize > 0) {
            return SimpleAccount(payable(addr));
        }
        ret = new SimpleAccount{salt : bytes32(salt)}(entryPoint, owner);
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by deployAccount()
     */
    function getAddress(IEntryPoint entryPoint, address owner, uint salt) public view returns (address) {
        return Create2.computeAddress(bytes32(salt), keccak256(abi.encodePacked(
                type(SimpleAccount).creationCode,
                abi.encode(entryPoint, owner))
            ));
    }
}
