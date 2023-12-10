// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import {RIP7560Account} from "./RIP7560Account.sol";

contract RIP7560Deployer {

    uint256 public deplCounter = 0;

    event DeployerEvent(string name, uint256 counter, address deployed);

    function createAccount(address owner) public returns (address ret) {
        ret = address(new RIP7560Account());
        emit DeployerEvent("the-deployer", deplCounter, ret);
        deplCounter++;
    }
}
