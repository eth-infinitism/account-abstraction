// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./UserOperation.sol";

interface ITSPAccount {
    function resetOwner(address newAddress) external ;
}
