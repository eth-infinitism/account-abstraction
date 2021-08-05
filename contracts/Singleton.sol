// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./StakeManager.sol";
import "./UserOperation.sol";
import "./IWallet.sol";
import "./IPaymaster.sol";


contract Singleton is StakeManager {

    using UserOperationLib for UserOperation;
    // paymaster locked stake
    // (actual stake should be higher, to cover actual call cost)
    uint256 constant PAYMASTER_STAKE = 1 ether;

    //lock period for stake.
    uint256 constant STAKE_LOCK_BLOCKS = 300;

    uint256 MAX_CHECK_GAS = 100_000;
    uint256 POST_CALL_GAS_OVERHEAD = 50_000;

    event UserOperationEvent(address indexed from, address indexed to, address indexed paymaster, uint actualGasGost, bool success);
    event UserOperationRevertReason(bytes revertReason);

    //handleOps reverts with this error struct, to mark the offending op
    // NOTE: if simulateOp passes successfully, there should be no reason for handleOps to fail on it.
    error FailedOp(uint op, string reason);

    receive() external payable {}

    function handleOps(UserOperation[] calldata ops) public {

        uint256 savedBalance = address(this).balance;
        uint opslen = ops.length;
        uint256[] memory savedGas = new uint256[](opslen);
        bytes32[] memory contexts = new bytes32[](opslen);

        uint priorityFee = tx.gasprice - tx_basefee();

        for (uint i = 0; i < opslen; i++) {
            UserOperation calldata op = ops[i];
            validateGas(op, priorityFee);

            uint preGas = gasleft();
            contexts[i] = validatePrepayment(i, op);
            savedGas[i] = preGas - gasleft();
        }

        for (uint i = 0; i < ops.length; i++) {
            uint preGas = gasleft();
            UserOperation calldata op = ops[i];
            bytes32 context = contexts[i];
            (bool success,) = address(this).call(abi.encodeWithSelector(this.handleSingleOp.selector, op, context, savedGas[i]));
            if (!success) {
                uint actualGas = preGas - gasleft();
                handlePostOp(IPaymaster.PostOpMode.postOpReverted, op, context, actualGas + savedGas[i]);
            }

            savedGas[i] += preGas - gasleft();
        }

        payable(address(msg.sender)).transfer(address(this).balance - savedBalance);
    }

    function handleSingleOp(UserOperation calldata op, bytes32 context, uint preOpCost) external {
        require(msg.sender == address(this));

        uint preGas = gasleft();
        (bool success,bytes memory result) = address(op.opData.target).call{gas : op.opData.callGas}(op.opData.callData);
        if (!success && result.length > 0) {
            emit UserOperationRevertReason(result);
        }
        IPaymaster.PostOpMode mode = success ? IPaymaster.PostOpMode.opSucceeded : IPaymaster.PostOpMode.opReverted;

        uint actualGasCost = preGas - gasleft() + preOpCost;
        handlePostOp(mode, op, context, actualGasCost);
        emit UserOperationEvent(op.signer, op.opData.target, op.payData.paymaster, actualGasCost, success);
    }

    //validate it doesn't revert (paymaster, wallet validate request)
    //  has payment (from wallet: from paymaster we only make sure stake is enough)
    // accesslist should be used collected.
    function simulateOp(UserOperation calldata op) external {
        //make sure this method is only called off-chain
        require(msg.sender == address(0), "must be called off-chain with from=zero-addr");
        validatePrepayment(0, op);
    }

    function tx_basefee() internal pure returns (uint ret){
        //TODO: needed solidity with basefee support (at least in assembly, better with tx.basefee)
        assembly {
        // ret := basefee()
            ret := 0
        }
    }

    function validateGas(UserOperation calldata userOp, uint priorityFee) internal pure {
        require(userOp.payData.maxPriorityFeePerGas <= priorityFee);
    }

    function validatePrepayment(uint opIndex, UserOperation calldata op) private returns (bytes32 context){

        if (!op.hasPaymaster()) {
            uint preBalance = address(this).balance;
            try IWallet(op.opData.target).payForSelfOp{gas : MAX_CHECK_GAS}(op) {
                //note: this "revert" doesn't get catched below
                if (address(this).balance - preBalance < op.requiredPreFund()) {
                    revert FailedOp(opIndex, "wallet didn't pay prefund");
                }
                context = bytes32(0);
            } catch Error(string memory message) {
                revert FailedOp(opIndex, message);
            } catch {
                revert FailedOp(opIndex, "");
            }
        } else {
            IWallet(op.opData.target).payForSelfOp{gas : MAX_CHECK_GAS}(op);
            require(isValidStake(op), "not enough stake");
            //no pre-pay from paymaster
            context = IPaymaster(op.payData.paymaster).payForOp{gas : MAX_CHECK_GAS}(op);
        }
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }

    function handlePostOp(IPaymaster.PostOpMode mode, UserOperation calldata op, bytes32 context, uint actualGas) private {
        uint gasPrice = min(op.payData.maxPriorityFeePerGas + tx_basefee(), tx.gasprice);
        uint actualGasCost = actualGas * gasPrice;
        if (!op.hasPaymaster()) {
            //TODO: do we need postRevert for wallet?
            //NOTE: deliberately ignoring revert: wallet should accept refund.
            bool sendOk = payable(op.opData.target).send(op.requiredPreFund() - actualGasCost);
            (sendOk);
        } else {
            //paymaster balance known to be high enough, and to be locked for this block
            stakes[op.payData.paymaster].stake -= uint112(actualGasCost);
            if (context != bytes32(0)) {
                IPaymaster(op.payData.paymaster).postOp(mode, op, context, actualGasCost);
            }
        }
    }


    function isValidStake(UserOperation calldata op) internal view returns (bool) {
        return isPaymasterStaked(op.payData.paymaster, STAKE_LOCK_BLOCKS + op.requiredPreFund());
    }
}

