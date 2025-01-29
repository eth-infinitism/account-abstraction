pragma solidity ^0.8.23;
// SPDX-License-Identifier: MIT
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../core/BaseAccount.sol";
import "../core/Eip7702Support.sol";

contract TestEip7702DelegateAccount is BaseAccount {

    IEntryPoint private immutable _entryPoint;
    bool public testInitCalled;

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
    }

    function testInit() public {
        testInitCalled = true;
    }

    function entryPoint() public view override virtual returns (IEntryPoint) {
        return _entryPoint;
    }

    // Require the function call went through EntryPoint or owner
    function _requireFromEntryPointOrOwner() internal view {
        require(msg.sender == address(this) || msg.sender == address(entryPoint()), "account: not Owner or EntryPoint");
    }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     * @param dest destination address to call
     * @param value the value to pass in this call
     * @param func the calldata to pass in this call
     */
    function execute(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPointOrOwner();
        (bool success,) = dest.call{value: value}(func);
        require(success, "call failed");
    }

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        if (userOp.initCode.length > 20) {
            require(testInitCalled, "testInit not called");
        }
        if (ECDSA.recover(userOpHash, userOp.signature) == address(this)) {
            return 0;
        }
        return 1;
    }
}
