// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../samples/DepositPaymaster.sol";

contract TestOracle is IOracle {
    function getTokenToEthOutputPrice(uint ethOutput) external pure override returns (uint tokenInput) {
        return ethOutput * 2;
    }
}
