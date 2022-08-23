// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable reason-string */

import "../interfaces/IAggregator.sol";
import "hardhat/console.sol";
import "./SimpleWallet.sol";

/**
 * test signature aggregator.
 * the aggregated signature is the SUM of the nonce fields..
 */
contract TestSignatureAggregator is IAggregator {

    function validateSignatures(UserOperation[] calldata userOps, bytes calldata signature) external pure override {
        uint sum = 0;
        for (uint i = 0; i < userOps.length; i++) {
            uint nonce = userOps[i].nonce;
            sum += nonce;
            // console.log('%s validate sender=%s nonce %s', i, address(senderWallet), nonce);
        }
        require(signature.length == 32, "TestSignatureValidator: sig must be uint");
        (uint sig) = abi.decode(signature, (uint));
        require(sig == sum, "TestSignatureValidator: aggregated signature mismatch (nonce sum)");
    }

    function validateUserOpSignature(UserOperation calldata userOp, bool)
    external pure returns (bytes memory sigForUserOp, bytes memory sigForAggregation, bytes memory offChainSigInfo) {
        return ("", abi.encode(userOp.nonce), abi.encodePacked(userOp.nonce));
    }

    /**
     * aggregate multiple signatures into a single value.
     * This method is called off-chain to calculate the signature to pass with handleOps()
     * bundler MAY use optimized custom code perform this aggregation
     * @param sigsForAggregation array of values returned by validateUserOpSignature() for each op
   * @return aggregatesSignature the aggregated signature
   */
    function aggregateSignatures(bytes[] calldata sigsForAggregation) external pure returns (bytes memory aggregatesSignature) {
        uint sum = 0;
        for (uint i = 0; i < sigsForAggregation.length; i++) {
            (uint nonce) = abi.decode(sigsForAggregation[i], (uint));
            sum += nonce;
        }
        return abi.encode(sum);
    }
}
