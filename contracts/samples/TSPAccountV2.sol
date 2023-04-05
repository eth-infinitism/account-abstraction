// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "./TSPAccount.sol";

/**
 * minimal account.
 *  this is sample minimal account.
 *  has execute, eth handling methods
 *  has a single signer that can send requests through the entryPoint.
 */
contract TSPAccountV2 is TSPAccount {
    constructor(IEntryPoint anEntryPoint) TSPAccount(anEntryPoint) {}

    function getVersion() public pure override returns (uint) {
        return 2;
    }
}
