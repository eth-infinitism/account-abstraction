// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol";
import "./EIP4337Manager.sol";
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
        address calc = getAddress(owner, salt);
        address created = address(proxyFactory.createProxyWithNonce(
                safeSingleton, getInitializer(owner), salt));
        require(calc == created, "created wrong address");
        return created;
    }

    function getInitializer(address owner) internal view returns (bytes memory) {
        address[] memory owners = new address[](1);
        owners[0] = owner;
        uint threshold = 1;
        address eip4337fallback = eip4337Manager.eip4337Fallback();

        bytes memory setup4337Modules = abi.encodeCall(
            EIP4337Manager.setup4337Modules, (eip4337Manager));

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
    // better calculate the real create2 address
    function getAddress1(address owner, uint salt) public returns (address addr) {
        try proxyFactory.calculateCreateProxyWithNonceAddress(
            safeSingleton, getInitializer(owner), salt)
        // solhint-disable-next-line no-empty-blocks
        returns (GnosisSafeProxy) {}
        catch (bytes memory errData) {
            //Error(string) with 32-byte string
            require(errData.length == 100, "wrong revert data");
            /* solhint-disable-next-line no-inline-assembly */
            assembly {
                addr := shr(96,mload(sub(add(errData, mload(errData)),0)))
            }
            return addr;
        }
        revert("never reach here");
    }

    /**
    * calculate the counterfactual address of this account as it would be returned by createAccount()
    */
    function getAddress(address owner, uint salt) public view returns (address) {
        bytes memory initializer = getInitializer(owner);
        //copied from deployProxyWithNonce
        bytes32 salt2 = keccak256(abi.encodePacked(keccak256(initializer), salt));
        bytes memory deploymentData = abi.encodePacked(type(GnosisSafeProxy).creationCode, uint256(uint160(safeSingleton)));
        return Create2.computeAddress(bytes32(salt2), keccak256(deploymentData));
    }
}
