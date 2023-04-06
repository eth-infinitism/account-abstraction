// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../interfaces/IAccount.sol";
import "../interfaces/ITSPAccount.sol";
import "../interfaces/IGuardian.sol";

contract Guardian is IGuardian {
    using SafeMath for uint256;
    // address public owner;
    mapping(address => IGuardian.GuardianConfig) private _cabinet;
    mapping(address => mapping(address => address)) private _approvesProgress;
    mapping(address => uint256) private _closestReset;

    function setConfig(
        address account,
        IGuardian.GuardianConfig memory config
    ) public {
        _requireAccountOwner(account);
        // Check the legality of the configuration
        require(
            config.approveThreshold > 0 && config.approveThreshold <= 100,
            "The threshold value must be a value greater than 0 and less than or equal to 100"
        );
        require(config.guardians.length <= 5, "Up to 5 guardians");
        require(
            config.delay > 0,
            "the number of delayed verification blocks 0 must be greater than or equal to 1"
        );
        _cabinet[account] = config;
        emit ChangeGuardianConfig(
            account,
            _cabinet[account].guardians,
            _cabinet[account].approveThreshold,
            _cabinet[account].delay
        );
    }

    // Owner authorized to modify the wallet
    function approve(address account, address newAddress) public {
        // Whether the verification is the guardian of the current account
        require(newAddress != address(0), "new owner is the zero address");
        require(
            isAddressInArray(_cabinet[account].guardians, msg.sender),
            "you are not a guardian"
        );
        IGuardian.GuardianConfig memory config = _cabinet[account];
        for (uint256 i = 0; i < config.guardians.length; i++) {
            address guardian = config.guardians[i];
            address otherGuardianAddress = _approvesProgress[account][guardian];
            // Check the guardian to assist in the designated EOA consistent
            if (
                otherGuardianAddress != address(0) &&
                otherGuardianAddress != newAddress
            ) {
                // Remove other addresses that are inconsistent with the current guardian
                delete _approvesProgress[account][guardian];
            }
        }
        _approvesProgress[account][msg.sender] = newAddress;
        _closestReset[account] = block.number + _cabinet[account].delay;
        emit Approved(account, msg.sender, newAddress);
    }

    function resetAccountOwner(address account) public {
        (address newAddress, uint256 progress) = _getApproveProgress(account);
        if (progress > _cabinet[account].approveThreshold) {
            if (_closestReset[account] > block.number) {
                revert("the delay reset time has not yet reached");
            }
            delete _closestReset[account];
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

    function clearApproves(address account) public {
        _requireAccountOwner(account);
        delete _closestReset[account];
        _clearApproves(account);
    }

    function _clearApproves(address account) private {
        IGuardian.GuardianConfig memory config = _cabinet[account];
        for (uint256 i = 0; i < config.guardians.length; i++) {
            address guardian = config.guardians[i];
            if (_approvesProgress[account][guardian] != address(0)) {
                delete _approvesProgress[account][guardian];
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
        IGuardian.GuardianConfig memory config = _cabinet[account];
        // if (config.guardians.length > 0) {
        //     return 0;
        // }
        uint256 n = 0;
        for (uint256 i = 0; i < config.guardians.length; i++) {
            address guardian = config.guardians[i];
            address addr = _approvesProgress[account][guardian];
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

    // Require the function call went through EntryPoint or owner
    function _requireAccountOwner(address account) internal view {
        require(
            msg.sender == account ||
                msg.sender == Ownable(payable(account)).owner(),
            "account: not the account owner"
        );
    }

    function getGuardianConfig(
        address account
    ) public view returns (IGuardian.GuardianConfig memory config) {
        return _cabinet[account];
    }
}
