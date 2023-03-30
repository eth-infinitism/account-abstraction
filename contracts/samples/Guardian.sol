// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../interfaces/IAccount.sol";
import "../interfaces/IGuardian.sol";
import "./TSPAccount.sol";
import "./TSPAccountFactory.sol";

contract Guardian is UUPSUpgradeable, Ownable {
    using SafeMath for uint256;
    // address public owner;
    uint256 private _defaultThreshold = 1;
    uint256 private _defaultDelayBlock = 100;
    address private _defaultGuardian;
    mapping(address => GuardianConfig) private cabinet;
    mapping(address => mapping(address => address)) private approvesProgress;

    // The guardian relationship of the storage account
    struct GuardianConfig {
        address[] guardians;
        uint256 approveThreshold;
        uint256 delay;
    }

    constructor(
        uint256 defaultThreshold,
        uint256 defaultDelayBlock,
        address defaultGuardian
    ) {
        _defaultThreshold = defaultThreshold;
        _defaultDelayBlock = defaultDelayBlock;
        _defaultGuardian = defaultGuardian;
    }

    function setConfig(address account, GuardianConfig memory config) public {
        _requireAccountOwner(account);
        // Check the legality of the configuration
        require(
            config.approveThreshold > 0,
            "the threshold value must be greater than 0"
        );
        require(config.guardians.length > 0, "at least 1 guardian is required");
        require(
            config.delay > 0,
            "the number of delayed verification blocks 0 must be greater than or equal to 1"
        );
        cabinet[account] = config;
    }

    function register(address account) public {
        require(
            cabinet[account].guardians.length == 0,
            "a TSP account can only be registered once"
        );
        // Initialized account relationship information
        address[] memory guardians = new address[](1);
        guardians[0] = _defaultGuardian;
        GuardianConfig memory _config = GuardianConfig(
            guardians,
            _defaultThreshold,
            _defaultDelayBlock
        );
        cabinet[account] = _config;
    }

    // function setDefaultConfig(uint256 defaultThreshold, uint256 defaultDelayBlock) public onlyOwner {
    //     require(defaultThreshold > 0, "the threshold must be greater than 0");
    //     require(defaultDelayBlock > 0, "the delay block must be greater than 0");
    //     _defaultThreshold = defaultThreshold;
    //     _defaultDelayBlock = defaultDelayBlock;
    // }

    // Owner authorized to modify the wallet
    function approve(address account, address newAddress) external {
        // Whether the verification is the guardian of the current account
        require(
            isAddressInArray(cabinet[account].guardians, msg.sender),
            "you're not a guardian"
        );
        // Check the progress of authorization
        // uint256 progress = _checkApproveProgress(account, newAddress);
        // if (progress > cabinet[account].approveThreshold) {
        //     _resetAccountOwner(account, newAddress);
        //     return;
        // }
        approvesProgress[account][msg.sender] = newAddress;
    }

    function resetAccountOwner(address account) public {
        require(
            isAddressInArray(cabinet[account].guardians, msg.sender),
            "you're not a guardian"
        );
        address newAddress = approvesProgress[account][msg.sender];
        uint256 progress = _checkApproveProgress(account, newAddress);
        if (progress > cabinet[account].approveThreshold) {
            _resetAccountOwner(account, newAddress);
        }
    }

    function _resetAccountOwner(address account, address newAddress) private {
        ITSPAccount(account).resetOwner(newAddress);
        // Clear authorization record
        _clearApproves(account);
    }

    function _clearApproves(address account) private {
        GuardianConfig memory config = cabinet[account];
        for (uint256 i = 0; i < config.guardians.length; i++) {
            address guardian = config.guardians[i];
            if (approvesProgress[account][guardian] != address(0)) {
                delete approvesProgress[account][guardian];
            }
        }
    }

    // Authorized inspection
    function _checkApproveProgress(
        address account,
        address newAddress
    ) private view returns (uint256) {
        GuardianConfig memory config = cabinet[account];
        uint256 n = 0;
        for (uint256 i = 0; i < config.guardians.length; i++) {
            address guardian = config.guardians[i];
            address otherGuardianAddress = approvesProgress[account][guardian];
            // Check the guardian to assist in the designated EOA consistent
            if (otherGuardianAddress == newAddress) {
                n++;
            }
        }

        return n.div(config.approveThreshold);
    }

    function isAddressInArray(
        address[] memory addresses,
        address target
    ) public pure returns (bool) {
        for (uint256 i = 0; i < addresses.length; i++) {
            if (addresses[i] == target) {
                return true;
            }
        }
        return false;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal view override {
        (newImplementation);
        _checkOwner();
    }

    // Require the function call went through EntryPoint or owner
    function _requireAccountOwner(address account) internal view {
        require(
            msg.sender == TSPAccount(payable(account)).owner(),
            "account: not Owner or EntryPoint"
        );
    }
}
