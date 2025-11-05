// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/* solhint-disable reason-string */

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../interfaces/IPaymaster.sol";
import "../interfaces/IEntryPoint.sol";
import "./Stakeable.sol";
import "./UserOperationLib.sol";
/**
 * Helper class for creating a paymaster.
 * provides helper methods for staking.
 * Validates that the postOp is called only by the entryPoint.
 */
abstract contract BasePaymaster is IPaymaster, Stakeable {
    IEntryPoint internal immutable _entryPoint;

    uint256 internal constant PAYMASTER_VALIDATION_GAS_OFFSET = UserOperationLib.PAYMASTER_VALIDATION_GAS_OFFSET;
    uint256 internal constant PAYMASTER_POSTOP_GAS_OFFSET = UserOperationLib.PAYMASTER_POSTOP_GAS_OFFSET;
    uint256 internal constant PAYMASTER_DATA_OFFSET = UserOperationLib.PAYMASTER_DATA_OFFSET;

    error NotFromEntryPoint(address msgSender, address entity,address entryPoint);
    error ERC165Error(address entryPoint, bytes4 interfaceId);
    error MustOverride();

    constructor(IEntryPoint __entryPoint, address owner) Ownable(owner) {
        _validateEntryPointInterface(__entryPoint);
        _entryPoint = __entryPoint;
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    // Sanity check: make sure this EntryPoint was compiled against the same
    // IEntryPoint of this paymaster
    function _validateEntryPointInterface(IEntryPoint __entryPoint) internal virtual {
        bytes4 epInterfaceId = type(IEntryPoint).interfaceId;
        require(
            IERC165(address(__entryPoint)).supportsInterface(epInterfaceId),
            ERC165Error(address(__entryPoint), epInterfaceId)
        );
    }

    /// @inheritdoc IPaymaster
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external override returns (bytes memory context, uint256 validationData) {
        _requireFromEntryPoint();
        return _validatePaymasterUserOp(userOp, userOpHash, maxCost);
    }

    /**
     * Validate a user operation.
     * @param userOp     - The user operation.
     * @param userOpHash - The hash of the user operation.
     * @param maxCost    - The maximum cost of the user operation.
     */
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) internal virtual returns (bytes memory context, uint256 validationData);

    /// @inheritdoc IPaymaster
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external override {
        _requireFromEntryPoint();
        _postOp(mode, context, actualGasCost, actualUserOpFeePerGas);
    }

    /**
     * Post-operation handler.
     * (verified to be called only through the entryPoint)
     * @dev If subclass returns a non-empty context from validatePaymasterUserOp,
     *      it must also implement this method.
     * @param mode          - Enum with the following options:
     *                        opSucceeded - User operation succeeded.
     *                        opReverted  - User op reverted. The paymaster still has to pay for gas.
     *                        postOpReverted - never passed in a call to postOp().
     * @param context       - The context value returned by validatePaymasterUserOp
     * @param actualGasCost - Actual cost of gas used so far (without this postOp call).
     * @param actualUserOpFeePerGas - the gas price this UserOp pays. This value is based on the UserOp's maxFeePerGas
     *                        and maxPriorityFee (and basefee)
     *                        It is not the same as tx.gasprice, which is what the bundler pays.
     */
    function _postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) internal virtual {
        (mode, context, actualGasCost, actualUserOpFeePerGas); // unused params
        // subclass must override this method if validatePaymasterUserOp returns a context
        revert MustOverride();
    }

    /**
     * Add a deposit for this paymaster, used for paying for transaction fees.
     */
    function deposit() public payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * Withdraw value from the deposit.
     * @param withdrawAddress - Target to send to.
     * @param amount          - Amount to withdraw.
     */
    function withdrawTo(
        address payable withdrawAddress,
        uint256 amount
    ) public onlyOwner {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    /**
     * Return current paymaster's deposit on the entryPoint.
     */
    function getDeposit() public virtual view returns (uint256) {
        return _entryPoint.balanceOf(address(this));
    }

    /**
     * Validate the call is made from a valid entrypoint
     */
    function _requireFromEntryPoint() internal virtual {
        require(msg.sender == address(entryPoint()),
            NotFromEntryPoint(
                msg.sender,
                address(this),
                address(entryPoint())
            )
        );
    }
}
