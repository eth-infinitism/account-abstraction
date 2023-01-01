// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../samples/SimpleAccount.sol";

/**
 * A test account, for testing expiry.
 * add "temporary" owners, each with a sigTimeRange time for each.
 * NOTE: this is not a full "session key" implementation: a real session key should probably limit
 * other things, like target contracts and methods to be called.
 */
contract TestExpiryAccount is SimpleAccount {
    using ECDSA for bytes32;

    mapping(address => uint256) public ownerDeadlines;

    // solhint-disable-next-line no-empty-blocks
    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint) {}

    function initialize(address anOwner) public virtual override initializer {
        super._initialize(anOwner);
        addTemporaryOwner(anOwner, type(uint256).max);
    }

    function addTemporaryOwner(address owner, uint256 sigTimeRange) public onlyOwner {
        ownerDeadlines[owner] = sigTimeRange;
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address)
    internal override view returns (uint256 sigTimeRange) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address signer = hash.recover(userOp.signature);
        sigTimeRange = ownerDeadlines[signer];
        //we have sigTimeRange for all valid owners. so zero sigTimeRange means "invalid signature"
        bool sigFound = sigTimeRange != 0;
        return packSigTimeRange(sigFound, uint64(sigTimeRange), 0);
    }
}
