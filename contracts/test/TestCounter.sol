// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

//sample "receiver" contract, for testing "exec" from wallet.
contract TestCounter {
    mapping(address => uint256) public counters;

    function count() public {
        counters[msg.sender] = counters[msg.sender] + 1;

    }

    function justemit() public {
        emit CalledFrom(msg.sender);
    }

    event CalledFrom(address sender);

    //helper method to waste gas
    // repeat - waste gas on writing storage in a loop
    // junk - dynamic buffer to stress the function size.
    mapping(uint256 => uint256) xxx;
    uint256 offset;

    function gasWaster(uint256 repeat, string calldata /*junk*/) external {
        for (uint256 i = 1; i <= repeat; i++) {
            offset++;
            xxx[offset] = i;
        }
    }
}