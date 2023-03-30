// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../interfaces/IAccount.sol";
import "../interfaces/IGuardian.sol";
import "./TSPAccountFactory.sol";

contract Guardian is UUPSUpgradeable, Initializable, Ownable {
    using SafeMath for uint256;
    // address public owner;
    uint256 private _defaultThreshold = 1;
    uint256 private _defaultDelayBlock = 100;
    address private _defaultGuardian;
    IEntryPoint private immutable _entryPoint;
    TSPAccountFactory private _factory;
    mapping(address => GuardianConfig) private cabinet;
    mapping(address => mapping(address => address)) private approvesProgress;

    // The guardian relationship of the storage account
    struct GuardianConfig {
        address[] guardians;
        uint256 approveThreshold;
        uint256 delay;
    }

    modifier onlyAccountFactory() {
        require(msg.sender == address(_factory), "only factory");
        _;
    }

    constructor(
        IEntryPoint anEntryPoint,
        TSPAccountFactory factory,
        uint256 defaultThreshold,
        uint256 defaultDelayBlock,
        address defaultGuardian
    ) {
        _entryPoint = anEntryPoint;
        _factory = factory;
        _defaultThreshold = defaultThreshold;
        _defaultDelayBlock = defaultDelayBlock;
        _defaultGuardian = defaultGuardian;
        _disableInitializers();
    }

    function register(address account) public onlyAccountFactory {
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
        uint256 progress = _checkApproveProgress(account, newAddress);
        if (progress > cabinet[account].approveThreshold) {
            _resetAccountOwner(account, newAddress);
            return;
        }
        approvesProgress[account][msg.sender] = newAddress;
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

    function changeAccountFactory(address factory) public onlyOwner {
        _factory = TSPAccountFactory(factory);
    }

    // function _onlyOwner() internal view {
    //     //directly from EOA owner, or through the account itself (which gets redirected through execute())
    //     require(
    //         msg.sender == owner || msg.sender == address(this),
    //         "only owner"
    //     );
    // }
}
