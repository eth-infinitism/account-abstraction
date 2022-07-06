//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

/**
 * storage layout of GnosisSafe.
 * module methods are accessed using "delegateCall", so it has access to the Safe's storage.
 * can't use GnosisSafe or the examples/library/GnosisSafeStorage, since it overlap member
 * name (nonce)
 */
contract GnosisSafeStorage {
    address internal __singleton;
    mapping(address => address) internal __modules;
    mapping(address => address) internal __owners;
    uint internal __ownerCount;
    uint internal __threshold;
    uint internal __nonce;
    bytes32 private _deprecatedDomainSeparator;
    mapping(bytes32 => uint256) internal __signedMessages;
    mapping(address => mapping(bytes32 => uint)) internal __approvedHashes;
}