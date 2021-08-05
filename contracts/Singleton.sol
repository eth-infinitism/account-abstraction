// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

import "./StakeManager.sol";

    struct OpData {
        address target;
        uint256 nonce;
        bytes callData;
        uint64 callGas;
    }

    struct PayData {
        uint maxGasFee;
        uint priorityFee;
        address paymaster;
    }

    struct UserOperation {
        OpData opData;
        PayData payData;
        address signer;
        bytes signature;
    }

library UserOperationLib {
    function requiredPreFund(UserOperation memory userOp) internal pure returns (uint) {
        //TODO: does paymaster has extra gas?
        return userOp.opData.callGas * userOp.payData.maxGasFee;
    }

    function clientPrePay(UserOperation memory userOp) internal pure returns (uint){
        if (hasPaymaster(userOp))
            return 0;
        return requiredPreFund(userOp);
    }

    function hasPaymaster(UserOperation memory userOp) internal pure returns (bool) {
        return userOp.payData.paymaster != address(0);
    }

    function hash(UserOperation memory userOp) internal pure returns (bytes32) {
        //TODO: pack entire structure
        return keccak256(abi.encodePacked(
                userOp.opData.target,
                userOp.opData.nonce,
                keccak256(userOp.opData.callData),
                userOp.opData.callGas
            ));
    }

}

interface IWallet {

    // validate user's signature and nonce
    //  must use clientPrePay to prepay for the TX
    function payForSelfOp(UserOperation calldata userOp) external;

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external;
}

//minimal wallet
// this is sample minimal wallet.
// has execute, eth handling methods
// has a single signer that can send requests through the singleton.
contract Wallet is IWallet {
    uint public nonce;
    address public owner;
    address public singleton;

    receive() external payable {}

    modifier onlyThroughSingleton() {
        _onlyThroughSingleton();
        _;
    }

    function _onlyThroughSingleton() internal view {
        require(msg.sender == address(this));
    }

    function transfer(address payable dest, uint amount) external onlyThroughSingleton {
        dest.transfer(amount);
    }

    function exec(address dest, bytes calldata func) external onlyThroughSingleton {
        (bool success,) = dest.call(func);
        require(success);
    }

    function updateSingleton(address _singleton) external onlyThroughSingleton {
        singleton = _singleton;
    }

    function payForSelfOp(UserOperation calldata userOp) external override {
        require(msg.sender == singleton, "not from Singleton");
        require(owner == userOp.signer, "not owner");
        _validateSignature(userOp);
        _validateAndIncrementNonce(userOp);
        uint prepay = UserOperationLib.clientPrePay(userOp);
        if (prepay != 0) {
            payable(msg.sender).transfer(prepay);
        }
    }

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external override {
        require(msg.sender == singleton);
        // solhint-disable-next-line avoid-low-level-calls
        (bool success,) = address(this).call(func);
        require(success);
    }

    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        require(nonce++ == userOp.opData.nonce, "invalid nonce");
    }

    function _validateSignature(UserOperation calldata userOp) internal pure {
        bytes32 hash = UserOperationLib.hash(userOp);
        (bytes32 r, bytes32 s) = abi.decode(userOp.signature, (bytes32, bytes32));
        uint8 v = uint8(userOp.signature[64]);
        require(userOp.signer == ecrecover(hash, v, r, s));
    }

}


interface IPaymaster {

    // pre-pay for the call validate user operation, and if agrees to pay (from stake)
    // revert to reject this request.
    // @returns context value to send to a postOp
    //  value is zero to signify postOp is not required at all.
    function payForOp(UserOperation calldata userOp) external returns (bytes32 context);

    // post-operation handler.
    // @param postRevert - after inner call reverted, this method is retried in the outer context.
    //          should NOT revert then (otherwise, miner will block this paymaster)
    // @param context - the context value returned by payForOp
    // @param actualGasCost - actual gas used so far (without the postOp itself).
    function postOp(bool postRevert, bytes32 context, uint actualGasCost) external;
}

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

    receive() external payable {}

    function handleOps(UserOperation[] calldata ops) public {

        uint256 savedBalance = address(this).balance;
        uint opslen = ops.length;
        uint256[] memory savedGas = new uint256[](opslen);
        bytes32[] memory contexts = new bytes32[](opslen);

        for (uint i = 0; i < opslen; i++) {
            UserOperation calldata op = ops[i];
            validateGas(ops[i]);

            uint preGas = gasleft();
            contexts[i] = validatePrepayment(i, op);
            savedGas[i] = preGas - gasleft();
        }

        for (uint i = 0; i < ops.length; i++) {
            uint preGas = gasleft();
            UserOperation calldata op = ops[i];
            bytes32 context = contexts[i];
            (bool success,) = address(this).call(abi.encodeWithSelector(this.handleSingleOp.selector, op, context, savedGas[i]));
            //TODO: capture original context
            if (!success) {
                uint actualGas = preGas - gasleft();
                handlePostOp(true, op, context, actualGas + savedGas[i]);
            }

            savedGas[i] += preGas - gasleft();
        }

        payable(address(msg.sender)).transfer(address(this).balance - savedBalance);
    }

    function handleSingleOp(UserOperation calldata op, bytes32 context, uint preOpCost) external {
        require(msg.sender == address(this));

        uint preGas = gasleft();
        (bool success,) = address(op.opData.target).call{gas : op.opData.callGas}(op.opData.callData);
        uint actualGasCost = preGas - gasleft() + preOpCost;
        handlePostOp(false, op, context, actualGasCost);
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
        assembly {
            // ret := basefee()
            ret := 0
        }
    }

    function validateGas(UserOperation calldata userOp) internal view {
        require(userOp.payData.maxGasFee <= tx.gasprice);
        uint priorityFee = tx.gasprice - tx_basefee();
        require(userOp.payData.priorityFee >= priorityFee);
    }

    error FailedOp(uint op, string reason);

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

    function handlePostOp(bool postRevert, UserOperation calldata op, bytes32 context, uint actualGas) private {
        uint actualGasCost = actualGas * tx.gasprice;
        if (!op.hasPaymaster()) {
            //TODO: do we need postRevert for wallet?
            //NOTE: deliberately ignoring revert: wallet should accept refund.
            payable(op.opData.target).send(op.requiredPreFund() - actualGasCost);
        } else {
            //paymaster balance known to be high enough, and to be locked for this block
            stakes[op.payData.paymaster].stake -= uint112(actualGasCost);
            if (context != bytes32(0)) {
                IPaymaster(op.payData.paymaster).postOp(postRevert, context, actualGasCost);
            }
        }
    }


    function isValidStake(UserOperation calldata op) internal view returns (bool) {
        return isPaymasterStaked(op.payData.paymaster, STAKE_LOCK_BLOCKS + op.requiredPreFund());
    }
}

