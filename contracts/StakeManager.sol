// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8;

import "hardhat/console.sol";

contract StakeManager {

    /// minimum number of blocks to after 'unlock' before amount can be withdrawn.
    uint32 immutable public unstakeDelaySec;

    constructor(uint32 _unstakeDelaySec) {
        unstakeDelaySec = _unstakeDelaySec;
    }

    event StakeAdded(
        address indexed paymaster,
        uint256 totalStake,
        uint256 unstakeDelaySec
    );

    /// Emitted once a stake is scheduled for withdrawal
    event StakeUnlocking(
        address indexed paymaster,
        uint256 withdrawTime
    );

    event StakeWithdrawn(
        address indexed paymaster,
        address withdrawAddress,
        uint256 amount
    );

    /// @param stake - amount of ether staked for this paymaster
    /// @param withdrawStake - once 'unlocked' the value is no longer staked.
    /// @param withdrawTime - first block timestamp where 'withdraw' will be callable, or zero if the unlock has not been called
    struct StakeInfo {
        uint96 stake;
        uint32 unstakeDelaySec;
        uint96 withdrawStake;
        uint32 withdrawTime;
    }

    /// maps relay managers to their stakes
    mapping(address => StakeInfo) public stakes;

    function getStakeInfo(address paymaster) external view returns (StakeInfo memory stakeInfo) {
        return stakes[paymaster];
    }

    /**
     * add a deposit (just like stake, but with lock=0
     * cancel any pending unlock
     */
    function addDeposit() external payable {
        addStake(0);
    }

    //add deposit to another account (doesn't change lock status)
    function addDepositTo(address target) external payable {
        stakes[target].stake += uint96(msg.value);
    }

    /**
     * add stake value for this paymaster.
     * cancel any pending unlock
     */
    function addStake(uint32 _unstakeDelaySec) public payable {
        require(_unstakeDelaySec >= stakes[msg.sender].unstakeDelaySec, "cannot decrease unstake time");
        uint96 stake = uint96(stakes[msg.sender].stake + msg.value + stakes[msg.sender].withdrawStake);
        stakes[msg.sender] = StakeInfo(
            stake,
            _unstakeDelaySec,
            0,
            0);
        emit StakeAdded(msg.sender, stake, _unstakeDelaySec);
    }

    function unlockStake() external {
        StakeInfo storage info = stakes[msg.sender];
        require(info.withdrawTime == 0, "already pending");
        require(info.stake != 0 && info.unstakeDelaySec != 0, "no stake to unlock");
        uint32 withdrawTime = uint32(block.timestamp) + info.unstakeDelaySec;
        info.withdrawTime = withdrawTime;
        info.withdrawStake = info.stake;
        info.stake = 0;
        emit StakeUnlocking(msg.sender, withdrawTime);
    }

    function withdrawStake(address payable withdrawAddress) external {
        StakeInfo memory info = stakes[msg.sender];
        if (info.unstakeDelaySec != 0) {
            require(info.withdrawStake > 0, "no unlocked stake");
            require(info.withdrawTime <= block.timestamp, "Withdrawal is not due");
        }
        uint256 amount = info.withdrawStake + info.stake;
        stakes[msg.sender] = StakeInfo(0, info.unstakeDelaySec, 0, 0);
        withdrawAddress.transfer(amount);
        emit StakeWithdrawn(msg.sender, withdrawAddress, amount);
    }

    function isStaked(address paymaster, uint requiredStake, uint requiredDelaySec) public view returns (bool) {
        StakeInfo memory stakeInfo = stakes[paymaster];
        return stakeInfo.stake >= requiredStake && stakeInfo.unstakeDelaySec >= requiredDelaySec;
    }
}
