// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./StakeManager.sol";
import "./UserOperation.sol";
import "./IWallet.sol";
import "./IPaymaster.sol";
import "hardhat/console.sol";

contract Singleton is StakeManager {

    using UserOperationLib for UserOperation;
    // paymaster locked stake
    // (actual stake should be higher, to cover actual call cost)
    uint256 constant PAYMASTER_STAKE = 1 ether;

    //lock period for stake.
    uint256 constant STAKE_LOCK_BLOCKS = 300;

    event UserOperationEvent(address indexed account, address indexed paymaster, uint actualGasCost, uint actualGasPrice, bool success);
    event UserOperationRevertReason(bytes revertReason);

    event PaymasterPostOpFailed(address paymaster, address target, bytes reason);

    //handleOps reverts with this error struct, to mark the offending op
    // NOTE: if simulateOp passes successfully, there should be no reason for handleOps to fail on it.
    // @param opIndex - index into the array of ops to the failed one (in simulateOp, this is always zero)
    // @param paymaster - if paymaster.payForOp fails, this will be the paymaster's address. if payForSelfOp failed,
    //      this value will be zero (since it failed before accessing the paymaster)
    // @param reason - revert reason
    //  only to aid troubleshooting of wallet/paymaster reverts
    error FailedOp(uint opIndex, address paymaster, string reason);

    receive() external payable {}

    /**
     * Execute the given UserOperation.
     * @param op the operation to execute
     * @param redeemer the contract to redeem the fee
     */
    function handleOp(UserOperation calldata op, address payable redeemer) public {

        uint256 savedBalance = address(this).balance;

        uint preGas = gasleft();
        (uint256 prefund, bytes memory context) = _validatePrepayment(0, op);
        uint preOpGas = preGas - gasleft();

        uint valueFromPaymaster;
        try this.internalHandleOp(op, context, preOpGas, prefund) returns (uint _valueFromPaymaster) {
            valueFromPaymaster = _valueFromPaymaster;
        } catch {
            uint actualGas = preGas - gasleft() + preOpGas;
            valueFromPaymaster = handlePostOp(IPaymaster.PostOpMode.postOpReverted, op, context, actualGas, prefund, false);
        }
        uint collected = address(this).balance - savedBalance + valueFromPaymaster;

        redeemer.transfer(collected);
    }

    function handleOps(UserOperation[] calldata ops, address payable redeemer) public {

        uint256 savedBalance = address(this).balance;
        uint opslen = ops.length;
        uint256[] memory preOpGas = new uint256[](opslen);
        bytes32[] memory contexts = new bytes32[](opslen);
        uint256[] memory prefunds = new uint256[](opslen);

        for (uint i = 0; i < opslen; i++) {
            UserOperation calldata op = ops[i];

            uint preGas = gasleft();
            bytes memory context;
            bytes32 contextOffset;
            (prefunds[i], context) = _validatePrepayment(i, op);
            assembly {contextOffset := context}
            contexts[i] = contextOffset;
            preOpGas[i] = preGas - gasleft();
        }

        uint valueFromStake = 0;
        for (uint i = 0; i < ops.length; i++) {
            uint preGas = gasleft();
            UserOperation calldata op = ops[i];
            bytes32 contextOffset = contexts[i];
            bytes memory context;
            assembly {context := contextOffset}
            uint valueFromPaymaster;
            try this.internalHandleOp(op, context, preOpGas[i], prefunds[i]) returns (uint _valueFromPaymaster) {
                valueFromPaymaster = _valueFromPaymaster;
            } catch {
                uint actualGas = preGas - gasleft() + preOpGas[i];
                valueFromPaymaster = handlePostOp(IPaymaster.PostOpMode.postOpReverted, op, context, actualGas, prefunds[i], false);
            }
            valueFromStake += valueFromPaymaster;
        }

        uint collected = address(this).balance - savedBalance + valueFromStake;

        redeemer.transfer(collected);
    }

    function internalHandleOp(UserOperation calldata op, bytes calldata context, uint preOpGas, uint prefund) external returns (uint valueFromPaymaster) {
        require(msg.sender == address(this));

        uint preGas = gasleft();
        (bool success,bytes memory result) = address(op.target).call{gas : op.callGas}(op.callData);
        if (!success && result.length > 0) {
            emit UserOperationRevertReason(result);
        }
        IPaymaster.PostOpMode mode = success ? IPaymaster.PostOpMode.opSucceeded : IPaymaster.PostOpMode.opReverted;

        uint actualGas = preGas - gasleft() + preOpGas;
        return handlePostOp(mode, op, context, actualGas, prefund, success);
    }

    /**
     * Simulate a call for wallet.payForSelfOp.
     * Call must not revert.
     * @return gasUsedByPayForSelfOp - gas used by the validation, to pass into simulatePaymasterValidation.
     * The node must also verify it doesn't use banned opcode, and that it doesn't reference storage outside the wallet's data
     */
    function simulateWalletValidation(UserOperation calldata userOp) external returns (uint gasUsedByPayForSelfOp){
        require(msg.sender == address(0), "must be called off-chain with from=zero-addr");
        uint requiredPreFund = userOp.requiredPreFund();
        uint walletRequiredPrefund = userOp.hasPaymaster() ? 0 : requiredPreFund;
        (gasUsedByPayForSelfOp,) = _validateWalletPrepayment(0, userOp, walletRequiredPrefund);
    }

    /**
     * Simulate a call to paymaster.payForOp
     * do nothing if has no paymaster.
     * @param userOp the user operation to validate.
     * @param gasUsedByPayForSelfOp - the gas returned by simulateWalletValidation, as these 2 calls should share
     *  the same userOp.validationGas quota.
     * The node must also verify it doesn't use banned opcode, and that it doesn't reference storage outside the paymaster's data
     */
    function simulatePaymasterValidation(UserOperation calldata userOp, uint gasUsedByPayForSelfOp) external view returns (bytes memory context, uint gasUsedByPayForOp){
        if (!userOp.hasPaymaster()) {
            return ("", 0);
        }
        uint requiredPreFund = userOp.requiredPreFund();
        return _validatePaymasterPrepayment(0, userOp, requiredPreFund, gasUsedByPayForSelfOp);
    }

    // get the target address, or use "create2" to create it.
    // note that the gas allocation for this creation is deterministic (by the size of callData),
    // so it is not checked on-chain, and adds to the gas used by payForSelfOp
    function _createTargetIfNeeded(UserOperation calldata op) internal {
        if (op.initCode.length != 0) {
            //its a create operation. run the create2
            // note that we're still under the gas limit of validate, so probably
            // this create2 creates a proxy account.
            // appending signer makes the request unique, so no one else can make this request.
            bytes memory createData = op.initCode;
            //nonce is meaningless during create, so we re-purpose it as salt
            uint salt = op.nonce;
            address target1;
            assembly {
                target1 := create2(0, add(createData, 32), mload(createData), salt)
            }
            require(target1 != address(0), "create2 failed");
            require(target1 == op.target, "target doesn't match create2 address");
        }
    }

    //get counterfactual account address.
    function getAccountAddress(bytes memory bytecode, uint _salt) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                _salt,
                keccak256(bytecode)
            )
        );

        // NOTE: cast last 20 bytes of hash to address
        return address(uint160(uint256(hash)));
    }

    //call wallet.payForSelfOp, and validate that it paid as needed.
    // return actual value sent from wallet to "this"
    function _validateWalletPrepayment(uint opIndex, UserOperation calldata op, uint walletRequiredPrefund) internal returns (uint prefund, uint gasUsedByPayForSelfOp) {
        uint preGas = gasleft();
        _createTargetIfNeeded(op);
        uint preBalance = address(this).balance;
        try IWallet(op.target).payForSelfOp{gas : op.verificationGas}(op, walletRequiredPrefund) {
        } catch Error(string memory revertReason) {
            revert FailedOp(opIndex, address(0), revertReason);
        } catch {
            revert FailedOp(opIndex, address(0), "");
        }
        prefund = address(this).balance - preBalance;

        if (walletRequiredPrefund > 0) {
            if (prefund < walletRequiredPrefund) {
                revert FailedOp(opIndex, address(0), "wallet didn't pay prefund");
            }
        } else {
            if (prefund != 0) {
                revert FailedOp(opIndex, address(0), "has paymaster but wallet paid");
            }
        }
        gasUsedByPayForSelfOp = preGas - gasleft();
    }

    //validate paymaster.payForOp
    function _validatePaymasterPrepayment(uint opIndex, UserOperation calldata op, uint requiredPreFund, uint gasUsedByPayForSelfOp) internal view returns (bytes memory context, uint gasUsedByPayForOp) {
        uint preGas = gasleft();
        if (!isValidStake(op, requiredPreFund)) {
            revert FailedOp(opIndex, op.paymaster, "not enough stake");
        }
        //no pre-pay from paymaster
        uint gas = op.verificationGas - gasUsedByPayForSelfOp;
        try IPaymaster(op.paymaster).payForOp{gas : gas}(op, requiredPreFund) returns (bytes memory _context){
            context = _context;
        } catch Error(string memory revertReason) {
            revert FailedOp(opIndex, op.paymaster, revertReason);
        } catch {
            revert FailedOp(opIndex, op.paymaster, "");
        }
        gasUsedByPayForOp = preGas - gasleft();
    }

    function _validatePrepayment(uint opIndex, UserOperation calldata op) private returns (uint prefund, bytes memory context){

        uint preGas = gasleft();
        bool hasPaymaster = op.hasPaymaster();
        uint requiredPreFund = op.requiredPreFund();
        uint walletRequiredPrefund = hasPaymaster ? 0 : requiredPreFund;
        uint gasUsedByPayForSelfOp;
        (prefund, gasUsedByPayForSelfOp) = _validateWalletPrepayment(opIndex, op, walletRequiredPrefund);

        uint gasUsedByPayForOp = 0;
        if (hasPaymaster) {
            (context, gasUsedByPayForOp) = _validatePaymasterPrepayment(opIndex, op, requiredPreFund, gasUsedByPayForSelfOp);
        }
        uint gasUsed = preGas - gasleft();

        if (op.verificationGas < gasUsed) {
            revert FailedOp(opIndex, op.paymaster, "Used more than verificationGas");
        }
    }

    function getPaymastersStake(address[] calldata paymasters) external view returns (uint[] memory _stakes) {
        _stakes = new uint[](paymasters.length);
        for (uint i = 0; i < paymasters.length; i++) {
            _stakes[i] = stakes[paymasters[i]].stake;
        }
    }

    function handlePostOp(IPaymaster.PostOpMode mode, UserOperation calldata op, bytes memory context, uint actualGas, uint prefund, bool success) private returns (uint valueFromPaymaster) {
        uint gasPrice = UserOperationLib.gasPrice(op);
        uint preGas = gasleft();
        uint actualGasCost = actualGas * gasPrice;
        if (!op.hasPaymaster()) {
            if (prefund < actualGasCost) {
                revert ("fatal: prefund below actualGasCost");
            }
            //NOTE: deliberately ignoring revert: wallet should accept refund.
            bool sendOk = payable(op.target).send(prefund - actualGasCost);
            (sendOk);
            //charged wallet directly.
            valueFromPaymaster = 0;
        } else {
            if (context.length > 0) {
                //TODO: what to do if one paymaster reverts here?
                // - revert entire handleOps
                // - revert with the special FailedOp, to blame the paymaster.
                // - continue with the rest of the ops (paymaster pays from stake anyway)
                // - emit a message (just for sake of debugging of this poor paymaster)
                try IPaymaster(op.paymaster).postOp(mode, context, actualGasCost) {}
                catch (bytes memory errdata) {
                    emit PaymasterPostOpFailed(op.paymaster, op.target, errdata);
                }
            }
            //paymaster pays for full gas, including for postOp (and revert event)
            actualGasCost += (preGas - gasleft()) * gasPrice;
            //paymaster balance known to be high enough, and to be locked for this block
            stakes[op.paymaster].stake -= uint112(actualGasCost);
            valueFromPaymaster = actualGasCost;
        }
        emit UserOperationEvent(op.target, op.paymaster, actualGasCost, gasPrice, success);
    }

    function isValidStake(UserOperation calldata op, uint requiredPreFund) internal view returns (bool) {
        return isPaymasterStaked(op.paymaster, PAYMASTER_STAKE + requiredPreFund);
    }
}

