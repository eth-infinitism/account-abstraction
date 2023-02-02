// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../samples/SimpleAccount.sol";

/**
 * A test account, for testing expiry.
 * add "temporary" owners, each with a time range (since..till) times for each.
 * NOTE: this is not a full "session key" implementation: a real session key should probably limit
 * other things, like target contracts and methods to be called.
 * also, the "since" value is not really useful, only for testing the entrypoint.
 */
contract TestExpiryAccount is SimpleAccount {
    using ECDSA for bytes32;

    mapping(address => uint64) public ownerAfter;
    mapping(address => uint64) public ownerUntil;

    // solhint-disable-next-line no-empty-blocks
    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint) {}

    function initialize(address anOwner) public virtual override initializer {
        super._initialize(anOwner);
        addTemporaryOwner(anOwner, 0, type(uint64).max);
    }

    // As this is a test contract, no need for proxy, so no need to disable init
    // solhint-disable-next-line no-empty-blocks
    function _disableInitializers () internal override {}

    function addTemporaryOwner(address owner, uint64 _after, uint64 _until) public onlyOwner {
        require(_until > _after, "wrong until/after");
        ownerAfter[owner] = _after;
        ownerUntil[owner] = _until;
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address)
    internal override view returns (uint256 sigTimeRange) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address signer = hash.recover(userOp.signature);
        uint64 _until = ownerUntil[signer];
        uint64 _after = ownerAfter[signer];

        //we have "until" value for all valid owners. so zero means "invalid signature"
        bool sigFailed = _until == 0;
        return packSigTimeRange(sigFailed, _until, _after);
    }
}
