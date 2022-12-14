// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../interfaces/IEntryPoint.sol";
import "./BLSAccount.sol";

contract BLSAccountFactory {
    address private immutable accountImplementation;

    constructor(address _accountImplementation){
        accountImplementation = _accountImplementation;
    }

    function createAccount(IEntryPoint anEntryPoint, uint salt, uint256[4] memory aPublicKey) public returns (BLSAccount) {
        return BLSAccount(payable(new ERC1967Proxy{salt : bytes32(salt)}(accountImplementation, abi.encodeWithSelector(BLSAccount.initialize.selector, anEntryPoint, aPublicKey))));
    }
}
