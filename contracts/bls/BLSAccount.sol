// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../samples/SimpleAccount.sol";
import "./IBLSAccount.sol";

/**
 * Minimal BLS-based account that uses an aggregated signature.
 * The account must maintain its own BLS public-key, and expose its trusted signature aggregator.
 * Note that unlike the "standard" SimpleAccount, this account can't be called directly
 * (normal SimpleAccount uses its "signer" address as both the ecrecover signer, and as a legitimate
 * Ethereum sender address. Obviously, a BLS public is not a valid Ethereum sender address.)
 */
contract BLSAccount is SimpleAccount, IBLSAccount {
    address public immutable aggregator;
    uint256[4] private publicKey;

    // The constructor is used only for the "implementation" and only sets immutable values.
    // Mutable values slots for proxy accounts are set by the 'initialize' function.
    constructor(IEntryPoint anEntryPoint, address anAggregator) SimpleAccount(anEntryPoint)  {
        aggregator = anAggregator;
    }

    function initialize(uint256[4] memory aPublicKey) public virtual initializer {
        super._initialize(address(0));
        publicKey = aPublicKey;
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address userOpAggregator)
    internal override view returns (uint256 deadline) {

        (userOp, userOpHash);
        require(userOpAggregator == aggregator, "BLSAccount: wrong aggregator");
        return 0;
    }

    event PublicKeyChanged(uint256[4] oldPublicKey, uint256[4] newPublicKey);

    function setBlsPublicKey(uint256[4] memory newPublicKey) external onlyOwner {
        emit PublicKeyChanged(publicKey, newPublicKey);
        publicKey = newPublicKey;
    }

    function getAggregator() external view returns (address) {
        return aggregator;
    }

    function getBlsPublicKey() external override view returns (uint256[4] memory) {
        return publicKey;
    }
}
