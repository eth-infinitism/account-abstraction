// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../IAggregator.sol";
import "hardhat/console.sol";
import "./SimpleWallet.sol";

contract TestAggregator is IAggregator {
    function validateSignatures(UserOperation[] calldata userOps, bytes calldata signature) view override external {
        for (uint i = 0; i < userOps.length; i++) {
            SimpleWallet senderWallet = SimpleWallet(payable(userOps[i].sender));
            //not really needed...
            uint nonce = senderWallet.nonce();
//            console.log('%s validate sender=%s nonce %s', i, address(senderWallet), nonce);
        }
    }
}