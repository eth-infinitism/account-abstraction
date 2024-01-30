// SPDX-License-Identifier: GPL-3.0

/* solhint-disable one-contract-per-file */
/* solhint-disable avoid-low-level-calls */
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../samples/SimpleAccount.sol";
import "../interfaces/IAccountExecute.sol";

/**
 * a sample account with execUserOp.
 * Note that this account does nothing special with the userop, just extract
 * call to execute. In theory, such account can reference the signature, the hash, etc.
 */
contract TestExecAccount is SimpleAccount, IAccountExecute {

    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint){
    }

    event Executed(PackedUserOperation userOp, bytes innerCallRet);

    function executeUserOp(PackedUserOperation calldata userOp, bytes32 /*userOpHash*/) external {
        _requireFromEntryPointOrOwner();

        // read from the userOp.callData, but skip the "magic" prefix (executeUserOp sig),
        // which caused it to call this method.
        bytes calldata innerCall = userOp.callData[4 :];

        bytes memory innerCallRet;
        if (innerCall.length > 0) {
            (address target, bytes memory data) = abi.decode(innerCall, (address, bytes));
            bool success;
            (success, innerCallRet) = target.call(data);
            require(success, "inner call failed");
        }

        emit Executed(userOp, innerCallRet);
    }
}

contract TestExecAccountFactory {
    TestExecAccount public immutable accountImplementation;

    constructor(IEntryPoint _entryPoint) {
        accountImplementation = new TestExecAccount(_entryPoint);
    }

    function createAccount(address owner, uint256 salt) public returns (address ret) {
        address addr = getAddress(owner, salt);
        uint256 codeSize = addr.code.length;
        if (codeSize > 0) {
            return addr;
        }
        ret = address(new ERC1967Proxy{salt: bytes32(salt)}(
            address(accountImplementation),
            abi.encodeCall(SimpleAccount.initialize, (owner))
        ));
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by createAccount()
     */
    function getAddress(address owner, uint256 salt) public view returns (address) {
        return Create2.computeAddress(bytes32(salt), keccak256(abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(
                address(accountImplementation),
                abi.encodeCall(SimpleAccount.initialize, (owner))
            )
        )));
    }
}
