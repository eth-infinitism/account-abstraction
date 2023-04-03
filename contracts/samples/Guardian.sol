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
    uint256 private _defaultThreshold = 100;
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
            config.approveThreshold > 0 && config.approveThreshold <= 100,
            "The threshold value must be a value greater than 0 and less than or equal to 100"
        );
        require(config.guardians.length > 0, "at least 1 guardian is required");
        require(
            config.delay > 0,
            "the number of delayed verification blocks 0 must be greater than or equal to 1"
        );
        cabinet[account] = config;
        emit ChangeGuardianConfig(
            account,
            config.guardians,
            config.approveThreshold,
            config.delay
        );
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
        emit Register(account, _defaultGuardian);
    }

    // function setDefaultConfig(uint256 defaultThreshold, uint256 defaultDelayBlock) public onlyOwner {
    //     require(defaultThreshold > 0, "the threshold must be greater than 0");
    //     require(defaultDelayBlock > 0, "the delay block must be greater than 0");
    //     _defaultThreshold = defaultThreshold;
    //     _defaultDelayBlock = defaultDelayBlock;
    // }

    // Owner authorized to modify the wallet
    function approve(address account, address newAddress) public {
        // Whether the verification is the guardian of the current account
        require(newAddress != address(0), "new owner is the zero address");
        require(
            isAddressInArray(cabinet[account].guardians, msg.sender),
            "you are not a guardian"
        );
        GuardianConfig memory config = cabinet[account];
        for (uint256 i = 0; i < config.guardians.length; i++) {
            address guardian = config.guardians[i];
            address otherGuardianAddress = approvesProgress[account][guardian];
            // Check the guardian to assist in the designated EOA consistent
            if (
                otherGuardianAddress != address(0) &&
                otherGuardianAddress != newAddress
            ) {
                // Remove other addresses that are inconsistent with the current guardian
                delete approvesProgress[account][guardian];
            }
        }
        approvesProgress[account][msg.sender] = newAddress;
        emit Approved(account, msg.sender, newAddress);
    }

    function resetAccountOwner(address account) public {
        (address newAddress, uint256 progress) = _getApproveProgress(account);
        if (progress > cabinet[account].approveThreshold) {
            _resetAccountOwner(account, newAddress);
        } else {
            revert("the threshold value has not been reached");
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

    function getApproveProgress(
        address account
    ) public view returns (address newAddress, uint256 progress) {
        return _getApproveProgress(account);
    }

    function _getApproveProgress(
        address account
    ) private view returns (address first, uint256 progress) {
        GuardianConfig memory config = cabinet[account];
        // if (config.guardians.length > 0) {
        //     return 0;
        // }
        uint256 n = 0;
        for (uint256 i = 0; i < config.guardians.length; i++) {
            address guardian = config.guardians[i];
            address addr = approvesProgress[account][guardian];
            // Check the guardian to assist in the designated EOA consistent
            if (first == address(0) && addr != address(0)) {
                first = addr;
            }
            if (addr != address(0) && addr == first) {
                n += 1;
            }
        }
        return (first, n.mul(100).div(config.guardians.length));
    }

    // Authorized inspection
    // function _getApproveProgress(
    //     address account
    // ) private view returns (address newAddress, uint256 progress) {
    //     address[] memory addrs = _getApprovedAddrArray(account);
    //     return _getVoteResult(addrs);
    // }

    // function getApproveAddresses(
    //     address account
    // ) public view returns (address[] memory addresses) {
    //     return _getApprovedAddrArray(account);
    // }

    // function _getApprovedAddrArray(
    //     address account
    // ) public view returns (address[] memory addresses) {
    //     GuardianConfig memory config = cabinet[account];
    //     for (uint256 i = 0; i < config.guardians.length; i++) {
    //         address guardian = config.guardians[i];
    //         address otherGuardianAddress = approvesProgress[account][guardian];
    //         // Check the guardian to assist in the designated EOA consistent
    //         addresses[i] = otherGuardianAddress;
    //     }
    // }

    // struct Vote {
    //     address addr;
    //     uint256 count;
    // }

    // function _getVoteResult(
    //     address[] memory votes
    // ) private pure returns (address, uint256) {
    //     require(votes.length > 0, "No votes found");

    //     // Initialize a map, record the number of votes of each address
    //     Vote[] memory votesArray = new Vote[](votes.length);
    //     uint256 totalVotes = votes.length;
    //     for (uint256 i = 0; i < votes.length; i++) {
    //         if (votes[i] != address(0)) {
    //             bool found = false;
    //             for (uint256 j = 0; j < votesArray.length; j++) {
    //                 if (votesArray[j].addr == votes[i]) {
    //                     votesArray[j].count += 1;
    //                     found = true;
    //                     break;
    //                 }
    //             }
    //             if (!found) {
    //                 votesArray[i] = Vote({addr: votes[i], count: 1});
    //             }
    //         }
    //     }

    //     // Find the most votes and the number of tickets and votes
    //     address winner;
    //     uint256 maxVotes = 0;
    //     for (uint256 i = 0; i < votesArray.length; i++) {
    //         if (votesArray[i].count > maxVotes) {
    //             winner = votesArray[i].addr;
    //             maxVotes = votesArray[i].count;
    //         }
    //     }

    //     // Calculation percentage
    //     uint256 percentage = (maxVotes * 100) / totalVotes;

    //     return (winner, percentage);
    // }

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
            "account: not Owner"
        );
    }

    function getGuardianConfig(
        address account
    ) public view returns (GuardianConfig memory config) {
        return cabinet[account];
    }
}
