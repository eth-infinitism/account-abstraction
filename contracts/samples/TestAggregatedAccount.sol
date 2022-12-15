// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../interfaces/IAggregatedAccount.sol";
import "../core/BaseAccount.sol";
import "./SimpleAccount.sol";
import "../interfaces/UserOperation.sol";

/**
 * test aggregated-signature account.
 * works only with TestAggregatedSignature, which doesn't really check signature, but nonce sum
 * a true aggregated account should expose data (e.g. its public key) to the aggregator.
 */
contract TestAggregatedAccount is SimpleAccount, IAggregatedAccount {
    address public immutable aggregator;

    // The constructor is used only for the "implementation" and only sets immutable values.
    // Mutable values slots for proxy accounts are set by the 'initialize' function.
    constructor(IEntryPoint anEntryPoint, address anAggregator) SimpleAccount(anEntryPoint) {
        aggregator = anAggregator;
    }

    function initialize(address) public virtual override initializer {
        super._initialize(address(0));
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address userOpAggregator)
    internal override view returns (uint256 deadline) {
        (userOp, userOpHash);
        require(userOpAggregator == aggregator, "wrong aggregator");
        return 0;
    }

    function getAggregator() external override view returns (address) {
        return aggregator;
    }
}
