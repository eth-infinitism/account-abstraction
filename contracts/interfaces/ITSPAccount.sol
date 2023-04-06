// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

interface ITSPAccount {
    event ResetOwner(
        address indexed account,
        address oldOwner,
        address newOwner
    );

    function resetOwner(address newAddress) external;
}
