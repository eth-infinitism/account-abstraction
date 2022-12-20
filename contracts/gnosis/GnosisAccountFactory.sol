// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./EIP4337Manager.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "../utils/Exec.sol";
/**
 * A wrapper factory contract to deploy GnosisSafe as an Account-Abstraction wallet contract.
 */
contract GnosisSafeAccountFactory {

    GnosisSafeProxyFactory public immutable proxyFactory;
    address public immutable safeSingleton;
    EIP4337Manager public immutable eip4337Manager;

    constructor(GnosisSafeProxyFactory _proxyFactory, address _safeSingleton, EIP4337Manager _eip4337Manager) {
        proxyFactory = _proxyFactory;
        safeSingleton = _safeSingleton;
        eip4337Manager = _eip4337Manager;
    }

    function createAccount(address owner, uint salt) public returns (address) {
        return address(proxyFactory.createProxyWithNonce(
                safeSingleton, getInitializer(owner), salt));
    }

    function getInitializer(address owner) internal view returns (bytes memory) {
        address[] memory owners = new address[](1);
        owners[0] = owner;
        uint threshold = 1;
        address eip4337fallback = eip4337Manager.eip4337Fallback();

        bytes memory setup4337Modules = abi.encodeCall(
            EIP4337Manager.setup4337Modules, (eip4337Manager));
        console.log("getinitializer");

        return abi.encodeCall(GnosisSafe.setup, (
            owners, threshold,
            address (eip4337Manager), setup4337Modules,
            eip4337fallback,
            address(0), 0, payable(0) //no payment receiver
            ));
    }

    //an INEFFICIENT way to get the address.
    // gnosis proxy runs the deployment, and reverts in order to get the address
    // this also doesn't help if the account is already deployed.
    function getAddress(address owner, uint salt) public returns (address addr) {
        try proxyFactory.calculateCreateProxyWithNonceAddress(
            safeSingleton, getInitializer(owner), salt)
        returns (GnosisSafeProxy) {}
        catch (bytes memory errData) {
            //Error(string) with 32-byte string
            require(errData.length == 100, "wrong revert data");
            assembly {
                addr := shr(96,mload(sub(add(errData, mload(errData)),0)))
            }
            return addr;
        }
        revert("never reach here");
    }
}
