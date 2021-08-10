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

    event UserOperationEvent(address indexed account, address indexed paymaster, uint actualGasCost, uint actualGasPrice, bool success);
    event UserOperationRevertReason(bytes revertReason);

    //handleOps reverts with this error struct, to mark the offending op
    // NOTE: if simulateOp passes successfully, there should be no reason for handleOps to fail on it.
    error FailedOp(uint op, string reason);

    receive() external payable {}

    function handleOps(UserOperation[] calldata ops, address payable redeemer) public {

        uint256 savedBalance = address(this).balance;
        uint opslen = ops.length;
        uint256[] memory savedGas = new uint256[](opslen);
        bytes32[] memory contexts = new bytes32[](opslen);

        uint priorityFee = tx.gasprice - UserOperationLib.tx_basefee();

        for (uint i = 0; i < opslen; i++) {
            UserOperation calldata op = ops[i];
            validateGas(op, priorityFee);

            uint preGas = gasleft();
            contexts[i] = validatePrepayment(i, op);
            uint gasUsed = preGas - gasleft();
            savedGas[i] = gasUsed;
        }

        uint valueFromStake = 0;
        for (uint i = 0; i < ops.length; i++) {
            uint preGas = gasleft();
            UserOperation calldata op = ops[i];
            bytes32 context = contexts[i];
            (bool success, bytes memory ret) = address(this).call(abi.encodeWithSelector(this.handleSingleOp.selector, op, context, savedGas[i]));
            uint valueFromPaymaster;
            if (success) {
                (valueFromPaymaster) = abi.decode(ret, (uint));
            } else {
                uint actualGas = preGas - gasleft();
                valueFromPaymaster = handlePostOp(IPaymaster.PostOpMode.postOpReverted, op, context, actualGas + savedGas[i], false);
            }
            valueFromStake += valueFromPaymaster;
        }

        uint collected = address(this).balance - savedBalance + valueFromStake;

        redeemer.transfer(collected);
    }

    function handleSingleOp(UserOperation calldata op, bytes32 context, uint preOpGas) external returns (uint valueFromPaymaster) {
        require(msg.sender == address(this));

        uint preGas = gasleft();
        (bool success,bytes memory result) = address(op.target).call{gas : op.callGas}(op.callData);
        if (!success && result.length > 0) {
            emit UserOperationRevertReason(result);
        }
        IPaymaster.PostOpMode mode = success ? IPaymaster.PostOpMode.opSucceeded : IPaymaster.PostOpMode.opReverted;

        uint actualGas = preGas - gasleft() + preOpGas;
        return handlePostOp(mode, op, context, actualGas, success);
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
        if (op.initCode.length!=0) {
            //its a create operation. run the create2
            // note that we're still under the gas limit of validate, so probably
            // this create2 creates a proxy account.
            bytes memory createData = op.initCode;
            //nonce is meaningless during create, so we re-purpose it as salt
            uint salt = op.nonce;
            address target1;
            assembly {
                target1 := create2(0, add(createData, 32), mload(createData), salt)
            }
            require(target1 != address(0), "create2 failed");
            require(target1==target, "target doesn't match create2 address");
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

    function validatePrepayment(uint opIndex, UserOperation calldata op) private returns (bytes32 context){

        IWallet target = IWallet(_getOrCreateTarget(op));
        if (!op.hasPaymaster()) {
            uint preBalance = address(this).balance;
            try target.payForSelfOp{gas : MAX_CHECK_GAS}(op) {
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
            target.payForSelfOp{gas : MAX_CHECK_GAS}(op);
            require(isValidStake(op), "not enough stake");
            //no pre-pay from paymaster
            context = IPaymaster(op.paymaster).payForOp{gas : MAX_CHECK_GAS}(op);
        }
    }

    function getPaymastersStake(address[] calldata paymasters) external view returns(uint[] memory _stakes) {
        _stakes = new uint[](paymasters.length);
        for ( uint i=0; i<paymasters.length; i++ ) {
            _stakes[i] = stakes[paymasters[i]].stake;
        }
    }

    function handlePostOp(IPaymaster.PostOpMode mode, UserOperation calldata op, bytes32 context, uint actualGas, bool success) private returns (uint valueFromPaymaster) {
        uint gasPrice = UserOperationLib.gasPrice(op);
        uint actualGasCost = actualGas * gasPrice;
        if (!op.hasPaymaster()) {
            //TODO: do we need postRevert for wallet?
            //NOTE: deliberately ignoring revert: wallet should accept refund.
            bool sendOk = payable(op.target).send(op.requiredPreFund() - actualGasCost);
            (sendOk);
            //charged wallet directly.
            valueFromPaymaster = 0;
        } else {
            //paymaster balance known to be high enough, and to be locked for this block
            stakes[op.paymaster].stake -= uint112(actualGasCost);
            valueFromPaymaster = actualGasCost;
            if (context != bytes32(0)) {
                //TODO: what to do if one paymaster reverts here?
                // - revert entire handleOps
                // - revert with the special FailedOp, to blame the paymaster.
                // - continue with the rest of the ops (paymaster pays from stake anyway)
                // - emit a message (just for sake of debugging of this poor paymaster)
                IPaymaster(op.paymaster).postOp(mode, op, context, actualGasCost);
            }
        }
        emit UserOperationEvent(op.target, op.paymaster, actualGasCost, gasPrice, success);
    }


    function isValidStake(UserOperation calldata op) internal view returns (bool) {
        return isPaymasterStaked(op.paymaster, STAKE_LOCK_BLOCKS + op.requiredPreFund());
    }
}

