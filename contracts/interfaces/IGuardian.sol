// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

interface IGuardian {
    // The guardian relationship of the storage account
    struct GuardianConfig {
        address[] guardians;
        uint256 approveThreshold;
        uint256 delay;
    }

    event Register(address indexed account, address indexed guardian);

    event Approved(
        address indexed account,
        address indexed guardian,
        address newOwner
    );

    event ChangeGuardianConfig(
        address indexed account,
        address[] guardians,
        uint256 approveThreshold,
        uint256 delayBlock
    );

    function setConfig(
        address account,
        IGuardian.GuardianConfig memory config
    ) external;
}
