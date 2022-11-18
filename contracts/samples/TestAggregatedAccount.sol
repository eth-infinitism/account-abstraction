// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../interfaces/IAggregatedAccount.sol";
import "../core/BaseAccount.sol";
import "./SimpleWallet.sol";
import "../interfaces/UserOperation.sol";

/**
 * test aggregated-signature wallet.
 * works only with TestAggregatedSignature, which doesn't really check signature, but nonce sum
 * a true aggregated wallet should expose data (e.g. its public key) to the aggregator.
 */
contract TestAggregatedAccount is SimpleWallet, IAggregatedAccount {
    address public immutable aggregator;

    constructor(IEntryPoint anEntryPoint, address anAggregator)
    SimpleWallet(anEntryPoint, address(0)) {
        aggregator = anAggregator;
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 requestId, address userOpAggregator)
    internal override view returns (uint256 deadline) {
        (userOp, requestId);
        require(userOpAggregator == aggregator, "wrong aggregator");
        return 0;
    }

    function getAggregator() external override view returns (address) {
        return aggregator;
    }
}
