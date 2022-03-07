// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

interface IOracle {

    /**
     * return amount of tokens that are required to receive that much eth.
     */
    function getTokenValueOfEth(uint ethOutput) external view returns (uint tokenInput);
}

