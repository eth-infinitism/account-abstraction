// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../UserOperation.sol";
import "../IWallet.sol";

//sample "receiver" contract, for testing "exec" from wallet.
contract TestCounter {
    mapping(address => uint) public counters;

    function count() public {
        counters[msg.sender] = counters[msg.sender] + 1;
    }
}