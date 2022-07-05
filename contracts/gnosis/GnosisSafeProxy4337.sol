//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

import "./EIP4337Module.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";

contract SafeProxy4337 is GnosisSafeProxy {
    constructor(
        address singleton, EIP4337Module aaModule,
        address[] memory owners, uint threshold
    ) GnosisSafeProxy(singleton) {
        (bool success,bytes memory ret) = address(aaModule).delegatecall(abi.encodeCall(EIP4337Module.setupEIP4337, (singleton, aaModule, owners, threshold)));
        require(success, string(ret));
    }
}
