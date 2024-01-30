// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "../samples/SimpleAccount.sol";
import "../core/Helpers.sol";

/**
 * test aggregated-signature account.
 * works only with TestAggregatedSignature, which doesn't really check signature, but nonce sum
 * a true aggregated account should expose data (e.g. its public key) to the aggregator.
 */
contract TestAggregatedAccount is SimpleAccount {
    address public immutable aggregator;

    // The constructor is used only for the "implementation" and only sets immutable values.
    // Mutable value slots for proxy accounts are set by the 'initialize' function.
    constructor(IEntryPoint anEntryPoint, address anAggregator) SimpleAccount(anEntryPoint) {
        aggregator = anAggregator;
    }

    /// @inheritdoc SimpleAccount
    function initialize(address) public virtual override initializer {
        super._initialize(address(0));
    }

    function _validateSignature(PackedUserOperation calldata userOp, bytes32 userOpHash)
    internal override view returns (uint256 validationData) {
        (userOp, userOpHash);
        return _packValidationData(ValidationData(aggregator, 0, 0));
    }
}
