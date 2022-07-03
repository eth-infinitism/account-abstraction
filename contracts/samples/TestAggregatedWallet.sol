// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../IAggregator.sol";
import "hardhat/console.sol";
import "./SimpleWallet.sol";

/**
 * test aggregated-signature wallet.
 * works only with TestAggregatedSignature, which doesn't really check signature, but nonce sum
 */
contract TestAggregatedWallet is SimpleWallet, IAggregatedWallet {
    address public immutable aggregator;

    constructor(EntryPoint anEntryPoint, address anAggregator)
    SimpleWallet(anEntryPoint, address(0)) {
        aggregator = anAggregator;
    }
    function _validateSignature(UserOperation calldata userOp, bytes32 ) internal pure override {
        //if we get with signature to this point, then it means handleOps was called
        // without assigning the aggregator to validate the signature of this userOp
        require(userOp.signature.length<64, "TestAggregatedWallet: must not have a signature");
    }

    function getAggregator() external override view returns (address) {
        return aggregator;
    }
}