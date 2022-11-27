// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../samples/SimpleAccount.sol";

/**
 * A test account, for testing expiry.
 * add "temporary" owners, each with a deadline time for each.
 * NOTE: this is not a full "session key" implementation: a real session key should probably limit
 * other things, like target contracts and methods to be called.
 */
contract TestExpiryAccount is SimpleAccount {
    using ECDSA for bytes32;

    mapping(address => uint256) public ownerDeadlines;

    constructor(IEntryPoint anEntryPoint, address anOwner) SimpleAccount(anEntryPoint, anOwner) {
        addTemporaryOwner(anOwner, type(uint256).max);
    }

    function addTemporaryOwner(address owner, uint256 deadline) public onlyOwner {
        ownerDeadlines[owner] = deadline;
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address)
    internal override view returns (uint256 deadline) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address signer = hash.recover(userOp.signature);
        deadline = ownerDeadlines[signer];
        require(deadline != 0, "account: wrong signature");
        //not testing deadline (since we can't). just return it.
    }
}
