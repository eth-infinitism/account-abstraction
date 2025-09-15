// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IEntryPoint.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title Stakeable
 * @notice Helper that lets a contract add stake on the configured EntryPoint
 *         for itself. Intended for factories or paymasters so their owner can call
 *         the contract directly instead of interacting with EntryPoint.
 */
abstract contract Stakeable is Ownable2Step {
    /**
     * @dev Implementations must supply the EntryPoint instance that should receive the stake.
     */
    function entryPoint() public view virtual returns (IEntryPoint);

    /**
     * Add stake for this contract.
     * This method can also carry eth value to add to the current stake.
     * @param unstakeDelaySec - The unstake delay for this contract. Can only be increased.
     */
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint().addStake{value: msg.value}(unstakeDelaySec);
    }

    /**
     * Unlock the stake, in order to withdraw it.
     * The contract can't serve requests once unlocked, until it calls addStake again
     */
    function unlockStake() external onlyOwner {
        entryPoint().unlockStake();
    }

    /**
     * Withdraw the entire contract's stake.
     * stake must be unlocked first (and then wait for the unstakeDelay to be over)
     * @param withdrawAddress - The address to send withdrawn value.
     */
    function withdrawStake(address payable withdrawAddress) external onlyOwner {
        entryPoint().withdrawStake(withdrawAddress);
    }
}
