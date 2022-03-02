// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8;

import "hardhat/console.sol";

/**
 * manage deposit of sender or paymaster, to pay for gas.
 * paymaster must stake some of the deposit.
 */
contract StakeManager {

    /// minimum number of blocks to after 'unlock' before amount can be withdrawn.
    uint32 immutable public unstakeDelaySec;

    constructor(uint32 _unstakeDelaySec) {
        unstakeDelaySec = _unstakeDelaySec;
    }

    event Deposited(
        address indexed account,
        uint256 totalDeposit,
        uint256 unstakeDelaySec
    );


    /// Emitted once a stake is scheduled for withdrawal
    event DepositUnstaked(
        address indexed account,
        uint256 withdrawTime
    );

    event Withdrawn(
        address indexed account,
        address withdrawAddress,
        uint256 withdrawAmount
    );

    /// @param amount of ether deposited for this account
    /// @param unstakeDelaySec - time the deposit is locked, after calling unlock (or zero if deposit is not locked)
    /// @param withdrawTime - first block timestamp where 'withdrawTo' will be callable, or zero if not locked
    struct DepositInfo {
        uint112 amount;
        uint32 unstakeDelaySec;
        uint64 withdrawTime;
    }

    /// maps accounts to their deposits
    mapping(address => DepositInfo) public deposits;

    function getDepositInfo(address account) public view returns (DepositInfo memory info) {
        return deposits[account];
    }

    function balanceOf(address account) public view returns (uint) {
        return deposits[account].amount;
    }

    receive() external payable {
        depositTo(msg.sender);
    }

    function internalIncrementDeposit(address account, uint amount) internal {
        deposits[account].amount += uint112(amount);
    }

    function internalDecrementDeposit(address account, uint amount) internal {
        deposits[account].amount -= uint112(amount);
    }

    /**
     * add to the deposit of the given account
     */
    function depositTo(address account) public payable {
        internalIncrementDeposit(account, msg.value);
        DepositInfo storage info = deposits[account];
        emit Deposited(account, info.amount, info.unstakeDelaySec);
    }

    /**
     * stake the account's deposit.
     * any pending unstakeDeposit is first cancelled.
     * can also set (or increase) the deposit with the call.
     * @param _unstakeDelaySec the new lock time before the deposit can be withdrawn.
     */
    function addStake(uint32 _unstakeDelaySec) public payable {
        DepositInfo storage info = deposits[msg.sender];
        require(_unstakeDelaySec >= unstakeDelaySec, "unstake delay too low");
        require(_unstakeDelaySec >= info.unstakeDelaySec, "cannot decrease unstake time");
        uint112 amount = info.amount + uint112(msg.value);
        deposits[msg.sender] = DepositInfo(
            amount,
            _unstakeDelaySec,
            0);
        emit Deposited(msg.sender, amount, _unstakeDelaySec);
    }

    /**
     * attempt to unstake the deposit.
     * the value can be withdrawn (using withdrawTo) after the unstake delay.
     */
    function unstakeDeposit() external {
        DepositInfo storage info = deposits[msg.sender];
        require(info.withdrawTime == 0, "already unstaking");
        require(info.unstakeDelaySec != 0, "not staked");
        uint64 withdrawTime = uint64(block.timestamp) + info.unstakeDelaySec;
        info.withdrawTime = withdrawTime;
        emit DepositUnstaked(msg.sender, withdrawTime);
    }

    /**
     * withdraw from the deposit.
     * will fail if the deposit is already staked or too low.
     * after a paymaster unlocks and withdraws some of the value, it must call addStake() to stake the value again.
     * @param withdrawAddress the address to send withdrawn value.
     * @param withdrawAmount the amount to withdraw.
     */
    function withdrawTo(address payable withdrawAddress, uint withdrawAmount) external {
        DepositInfo memory info = deposits[msg.sender];
        if (info.unstakeDelaySec != 0) {
            require(info.withdrawTime > 0, "must call unstakeDeposit() first");
            require(info.withdrawTime <= block.timestamp, "Withdrawal is not due");
        }
        require(withdrawAmount <= info.amount, "Withdraw amount too large");

        // store the remaining value, with stake info cleared.
        deposits[msg.sender] = DepositInfo(
            info.amount - uint112(withdrawAmount),
            0,
            0);
        emit Withdrawn(msg.sender, withdrawAddress, withdrawAmount);
        (bool success,) = withdrawAddress.call{value : withdrawAmount}("");
        require(success, "failed to withdraw");
    }

    /**
     * check if the given account is staked and didn't unlock it yet.
     * @param account the account (paymaster) to check
     * @param requiredStake the minimum deposit
     * @param requiredDelaySec the minimum required stake time.
     */
    function isStaked(address account, uint requiredStake, uint requiredDelaySec) public view returns (bool) {
        DepositInfo memory info = deposits[account];
        return info.amount >= requiredStake &&
        info.unstakeDelaySec >= requiredDelaySec &&
        info.withdrawTime == 0;
    }
}
