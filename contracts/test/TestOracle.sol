// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "../samples/IOracle.sol";

contract TestOracle is IOracle {
    function getTokenValueOfEth(uint256 ethOutput) external pure override returns (uint256 tokenInput) {
        return ethOutput * 2;
    }
}
