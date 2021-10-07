// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8;

import "hardhat/console.sol";

contract StakeManager {

    /// minimum number of blocks to after 'unlock' before amount can be withdrawn.
    uint32 immutable public unstakeDelayBlocks;

    constructor(uint32 _unstakeDelayBlocks) {
        unstakeDelayBlocks = _unstakeDelayBlocks;
    }

    event StakeAdded(
        address indexed paymaster,
        uint256 totalStake,
        uint256 unstakeDelayBlocks
    );

    /// Emitted once a stake is scheduled for withdrawal
    event StakeUnlocking(
        address indexed paymaster,
        uint256 withdrawBlock
    );

    event StakeWithdrawn(
        address indexed paymaster,
        address withdrawAddress,
        uint256 amount
    );

    /// @param stake - amount of ether staked for this paymaster
    /// @param withdrawStake - once 'unlocked' the value is no longer staked.
    /// @param withdrawBlock - first block number 'withdraw' will be callable, or zero if the unlock has not been called
    struct StakeInfo {
        uint96 stake;
        uint32 unstakeDelayBlocks;
        uint96 withdrawStake;
        uint32 withdrawBlock;
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
    function addStake(uint32 _unstakeDelayBlocks) public payable {
        require(_unstakeDelayBlocks >= stakes[msg.sender].unstakeDelayBlocks, "cannot decrease unstake blocks");
        uint96 stake = uint96(stakes[msg.sender].stake + msg.value + stakes[msg.sender].withdrawStake);
        stakes[msg.sender] = StakeInfo(
            stake,
            _unstakeDelayBlocks,
            0,
            0);
        emit StakeAdded(msg.sender, stake, _unstakeDelayBlocks);
    }

    function unlockStake() external {
        StakeInfo storage info = stakes[msg.sender];
        require(info.withdrawBlock == 0, "already pending");
        require(info.stake != 0 && info.unstakeDelayBlocks != 0, "no stake to unlock");
        uint32 withdrawBlock = uint32(block.number) + info.unstakeDelayBlocks;
        info.withdrawBlock = withdrawBlock;
        info.withdrawStake = info.stake;
        info.stake = 0;
        emit StakeUnlocking(msg.sender, withdrawBlock);
    }

    function withdrawStake(address payable withdrawAddress) external {
        StakeInfo memory info = stakes[msg.sender];
        if (info.unstakeDelayBlocks != 0) {
            require(info.withdrawStake > 0, "no unlocked stake");
            require(info.withdrawBlock <= block.number, "Withdrawal is not due");
        }
        uint256 amount = info.withdrawStake + info.stake;
        stakes[msg.sender] = StakeInfo(0, info.unstakeDelayBlocks, 0, 0);
        withdrawAddress.transfer(amount);
        emit StakeWithdrawn(msg.sender, withdrawAddress, amount);
    }

    function isStaked(address paymaster, uint requiredStake, uint requiredDelayBlocks) public view returns (bool) {
        StakeInfo memory stakeInfo = stakes[paymaster];
        return stakeInfo.stake >= requiredStake && stakeInfo.unstakeDelayBlocks >= requiredDelayBlocks;
    }
}
