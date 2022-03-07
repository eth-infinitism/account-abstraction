// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;
import "@openzeppelin/contracts/access/Ownable.sol";
import "./IPaymaster.sol";
import "./EntryPoint.sol";

/**
 * Helper class for creating a paymaster.
 * provider helper methods for staking.
 * validates that the postOp is called only by the entryPoint
 */
abstract contract BasePaymaster is IPaymaster, Ownable {

    EntryPoint public entryPoint;

    constructor(EntryPoint _entryPoint) {
        setEntrypoint(_entryPoint);
    }

    function setEntrypoint(EntryPoint _entryPoint) public onlyOwner {
        entryPoint = _entryPoint;
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 requestId, uint maxCost) external virtual override view returns (bytes memory context);

    function postOp(PostOpMode mode, bytes calldata context, uint actualGasCost) external override {
        _requireFromEntrypoint();
        _postOp(mode, context, actualGasCost);
    }

    /**
     * post-operation handler.
     * (verified to be called only through the entryPoint)
     * @dev if subclass returns a non-empty context from validatePaymasterUserOp, it must also implement this method.
     * @param mode enum with the following options:
     *      opSucceeded - user operation succeeded.
     *      opReverted  - user op reverted. still has to pay for gas.
     *      postOpReverted - user op succeeded, but caused postOp (in mode=opSucceeded) to revert.
     *                       Now this is the 2nd call, after user's op was deliberately reverted.
     * @param context - the context value returned by validatePaymasterUserOp
     * @param actualGasCost - actual gas used so far (without this postOp call).
     */
    function _postOp(PostOpMode mode, bytes calldata context, uint actualGasCost) internal virtual {

        (mode,context,actualGasCost); // unused params
        // subclass must override this method if validatePaymasterUserOp returns a context
        revert("must override");
    }

    /**
     * add stake for this paymaster
     * @param extraUnstakeDelaySec - extra delay (above the minimum required unstakeDelay of the entrypoint)
     */
    function addStake(uint32 extraUnstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value:msg.value}(entryPoint.unstakeDelaySec() + extraUnstakeDelaySec);
    }

    function getDeposit() public view returns (uint) {
        return entryPoint.balanceOf(address(this));
    }

    /**
     * attempt to unstake the deposit.
     * The paymaster can't serve requests once unstaked.
     */
    function unstakeDeposit() external onlyOwner {
        entryPoint.unstakeDeposit();
    }

    /**
     * withdraw from the paymaster's stake.
     * stake must be unlocked first.
     * after a paymaster unlocks and withdraws some of the value, it must call addStake() to stake the value again.
     * @param withdrawAddress the address to send withdrawn value.
     * @param withdrawAmount the amount to withdraw.
     */
    function withdrawTo(address payable withdrawAddress, uint withdrawAmount) external onlyOwner {
        entryPoint.withdrawTo(withdrawAddress, withdrawAmount);
    }

    /// validate the call is made from a valid entrypoint
    function _requireFromEntrypoint() internal virtual {
        require(msg.sender == address(entryPoint));
    }
}
