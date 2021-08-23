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

        uint priorityFee = tx.gasprice - block.basefee;

        validateGas(op, priorityFee);

        uint preGas = gasleft();
        (uint256 prefund, bytes32 context) = validatePrepayment(0, op);
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

        uint priorityFee = tx.gasprice - block.basefee;

        for (uint i = 0; i < opslen; i++) {
            UserOperation calldata op = ops[i];
            validateGas(op, priorityFee);

            uint preGas = gasleft();
            (prefunds[i], contexts[i]) = validatePrepayment(i, op);
            preOpGas[i] = preGas - gasleft();
        }

        uint valueFromStake = 0;
        for (uint i = 0; i < ops.length; i++) {
            uint preGas = gasleft();
            UserOperation calldata op = ops[i];
            bytes32 context = contexts[i];
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

    function internalHandleOp(UserOperation calldata op, bytes32 context, uint preOpGas, uint prefund) external returns (uint valueFromPaymaster) {
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

    //validate it doesn't revert (paymaster, wallet validate request)
    //  has payment (from wallet: from paymaster we only make sure stake is enough)
    // accesslist should be used collected.
    function simulateOp(UserOperation calldata op) external {
        //make sure this method is only called off-chain
        require(msg.sender == address(0), "must be called off-chain with from=zero-addr");
        validatePrepayment(0, op);
    }

    function validateGas(UserOperation calldata userOp, uint priorityFee) internal pure {
        require(userOp.maxPriorityFeePerGas <= priorityFee, "actual priorityFee too low");
    }

    // get the target address, or use "create2" to create it.
    // note that the gas allocation for this creation is deterministic (by the size of callData),
    // so it is not checked on-chain, and adds to the gas used by payForSelfOp
    function _getOrCreateTarget(UserOperation calldata op) internal returns (address target) {
        target = op.target;
        if (op.initCode.length != 0) {
            //its a create operation. run the create2
            // note that we're still under the gas limit of validate, so probably
            // this create2 creates a proxy account.
            // appending signer makes the request unique, so no one else can make this request.
            bytes memory createData = abi.encodePacked(op.initCode, op.signer);
            //nonce is meaningless during create, so we re-purpose it as salt
            uint salt = op.nonce;
            address target1;
            assembly {
                target1 := create2(0, add(createData, 32), mload(createData), salt)
            }
            require(target1 != address(0), "create2 failed");
            require(target1 == target, "target doesn't match create2 address");
        }
    }

    //get counterfactual account address.
    function getAccountAddress(bytes memory bytecode, uint _salt, address signer) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                _salt,
                keccak256(abi.encodePacked(bytecode, signer))
            )
        );

        // NOTE: cast last 20 bytes of hash to address
        return address(uint160(uint256(hash)));
    }

    function validatePrepayment(uint opIndex, UserOperation calldata op) private returns (uint prefund, bytes32 context){

        IWallet target = IWallet(_getOrCreateTarget(op));
        uint preBalance = address(this).balance;
        uint preGas = gasleft();
        try target.payForSelfOp{gas : op.verificationGas}(op) {
        } catch Error(string memory revertReason) {
            revert FailedOp(opIndex, address(0), revertReason);
        } catch {
            revert FailedOp(opIndex, address(0), "");
        }
        uint payForSelfOp_gasUsed = preGas - gasleft();
        prefund = address(this).balance - preBalance;

        if (!op.hasPaymaster()) {
            if (prefund < op.requiredPreFund()) {
                revert FailedOp(opIndex, address(0), "wallet didn't pay prefund");
            }
            context = bytes32(0);
        } else {
            if (prefund != 0) {
                revert FailedOp(opIndex, address(0), "has paymaster but wallet paid");
            }
            if (!isValidStake(op)) {
                revert FailedOp(opIndex, op.paymaster, "not enough stake");
            }
            //no pre-pay from paymaster
            try IPaymaster(op.paymaster).payForOp{gas : op.verificationGas - payForSelfOp_gasUsed}(op) returns (bytes32 _context){
                context = _context;
                prefund = 0;
            } catch Error(string memory revertReason) {
                revert FailedOp(opIndex, op.paymaster, revertReason);
            } catch {
                revert FailedOp(opIndex, op.paymaster, "");
            }
        }
    }

    function getPaymastersStake(address[] calldata paymasters) external view returns (uint[] memory _stakes) {
        _stakes = new uint[](paymasters.length);
        for (uint i = 0; i < paymasters.length; i++) {
            _stakes[i] = stakes[paymasters[i]].stake;
        }
    }

    function handlePostOp(IPaymaster.PostOpMode mode, UserOperation calldata op, bytes32 context, uint actualGas, uint prefund, bool success) private returns (uint valueFromPaymaster) {
        uint gasPrice = UserOperationLib.gasPrice(op);
        uint preGas = gasleft();
        uint actualGasCost = actualGas * gasPrice;
        if (!op.hasPaymaster()) {
            //NOTE: deliberately ignoring revert: wallet should accept refund.
            bool sendOk = payable(op.target).send(prefund - actualGasCost);
            (sendOk);
            //charged wallet directly.
            valueFromPaymaster = 0;
        } else {
            if (context != bytes32(0)) {
                //TODO: what to do if one paymaster reverts here?
                // - revert entire handleOps
                // - revert with the special FailedOp, to blame the paymaster.
                // - continue with the rest of the ops (paymaster pays from stake anyway)
                // - emit a message (just for sake of debugging of this poor paymaster)
                try IPaymaster(op.paymaster).postOp(mode, op, context, actualGasCost) {}
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


    function isValidStake(UserOperation calldata op) internal view returns (bool) {
        return isPaymasterStaked(op.paymaster, PAYMASTER_STAKE + op.requiredPreFund());
    }
}

