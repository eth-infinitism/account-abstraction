// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.23;

import "../core/BasePaymaster.sol";

/**
 * test postOp revert with custom error
 */
error CustomError(string customReason);

contract TestPaymasterRevertCustomError is BasePaymaster {
    bytes32 private constant INNER_OUT_OF_GAS = hex"deaddead";

    enum RevertType {
        customError,
        entryPointError
    }

    RevertType private revertType;

    // solhint-disable no-empty-blocks
    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint)
    {}

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
    internal virtual override view
    returns (bytes memory context, uint256 validationData) {
        validationData = 0;
        context = abi.encodePacked(userOp.sender);
    }

    function setRevertType(RevertType _revertType) external {
        revertType = _revertType;
    }

    function _postOp(PostOpMode, bytes calldata, uint256, uint256) internal view override {
        if (revertType == RevertType.customError){
            revert CustomError("this is a long revert reason string we are looking for");
        }
        else if (revertType == RevertType.entryPointError){
            // solhint-disable-next-line no-inline-assembly
            assembly {
                mstore(0, INNER_OUT_OF_GAS)
                revert(0, 32)
            }
        }
    }
}
