//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

/* solhint-disable avoid-low-level-calls */

import "./EIP4337Manager.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";

/**
 * Create a proxy to a GnosisSafe, which accepts calls through Account-Abstraction.
 * The created GnosisSafe has a single owner.
 * It is possible to add more owners, but currently, it can only be accessed via Account-Abstraction
 * if the owners threshold is exactly 1.
 */
contract SafeProxy4337 is GnosisSafeProxy {
    constructor(
        address singleton, EIP4337Manager aaModule,
        address owner
    ) GnosisSafeProxy(singleton) {
        (bool success,bytes memory ret) = address(aaModule).delegatecall(abi.encodeCall(
                EIP4337Manager.setupEIP4337, (singleton, aaModule, owner)));
        require(success, string(ret));
    }
}
