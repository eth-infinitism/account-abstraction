// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/*
 * This contract contains the view-only methods that are executed by the bundler in order to
 * check UserOperation validity and estimate its gas consumption.
 */
contract EntryPointSimulations {

    function return777() external pure returns (uint256) {
        return 777;
    }
}
