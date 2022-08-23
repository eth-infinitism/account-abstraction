// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../interfaces/IAggregatedWallet.sol";
import "../core/BaseWallet.sol";
import "./SimpleWallet.sol";
import "../interfaces/UserOperation.sol";

/**
 * test aggregated-signature wallet.
 * works only with TestAggregatedSignature, which doesn't really check signature, but nonce sum
 * a true aggregated wallet should expose data (e.g. its public key) to the aggregator.
 */
contract TestAggregatedWallet is SimpleWallet, IAggregatedWallet {
    address public immutable aggregator;

    constructor(IEntryPoint anEntryPoint, address anAggregator)
    SimpleWallet(anEntryPoint, address(0)) {
        aggregator = anAggregator;
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 requestId, address userOpAggregator) internal override view {
        (userOp, requestId);
        require(userOpAggregator == aggregator, "wrong aggregator");
    }

    function getAggregator() external override view returns (address) {
        return aggregator;
    }
}
