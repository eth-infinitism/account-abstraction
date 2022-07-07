// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../IAggregator.sol";
import "hardhat/console.sol";
import "./SimpleWallet.sol";

/**
 * test signature aggregator.
 * the aggregated signature is the SUM of the nonce fields..
 */
contract TestSignatureAggregator is IAggregator {

    function validateSignatures(UserOperation[] calldata userOps, bytes calldata signature) view override external {
        uint sum = 0;
        for (uint i = 0; i < userOps.length; i++) {
            SimpleWallet senderWallet = SimpleWallet(payable(userOps[i].sender));
            //not really needed...
            uint nonce = senderWallet.nonce();
            sum += nonce;
            // console.log('%s validate sender=%s nonce %s', i, address(senderWallet), nonce);
        }
        require(signature.length == 32, "TestSignatureValidator: sig must be uint");
        (uint sig) = abi.decode(signature, (uint));
        require(sig == sum, "TestSignatureValidator: aggregated signature mismatch (nonce sum)");
    }
}
