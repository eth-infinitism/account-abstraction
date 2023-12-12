// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/utils/Create2.sol";

import {RIP7560Account} from "./RIP7560Account.sol";

contract RIP7560Deployer {

    uint256 public deplCounter = 0;

    event DeployerEvent(string name, uint256 counter, address deployed);

    function createAccount(address owner, uint256 salt) external returns (address ret) {
        ret = address(new RIP7560Account{salt : bytes32(salt)}());
        emit DeployerEvent("the-deployer", deplCounter, ret);
        deplCounter++;
    }

    function getAddress(address owner,uint256 salt) public view returns (address) {
        return Create2.computeAddress(bytes32(salt), keccak256(abi.encodePacked(
            type(RIP7560Account).creationCode
        )));
    }
}
