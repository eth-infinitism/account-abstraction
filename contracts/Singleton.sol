// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

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
    function requiredPreFund(UserOperation calldata userOp) internal returns (uint) {
        //TODO: does paymaster has extra gas?
        return userOp.opData.callGas * userOp.payData.gasPrice;
    }

    function clientPrePay(UserOperation calldata userOp) internal returns (uint){
        if (hasPaymaster(userOp))
            return 0;
        return requiredPreFund(userOp);
    }

    function hasPaymaster(UserOperation calldata userOp) internal returns (bool) {
        return userOp.payData.paymaster != address(0);
    }

    function hash(UserOperation userOp) view returns (bytes32) {
        //TODO: calculate hash
        return keccak256(abi.encodePacked(0));
    }

}

interface IWallet {

    // validate user's signature and nonce
    //  must use clientPrePay to prepay for the TX
    function payForSelfOp(UserOperation userOp) external;

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external;
}

contract Wallet is IWallet {
    uint nonce;
    address owner;
    address singleton;

    fallback () external payable {}

    function transfer(address dest, uint amount) external {
        //callable only though execFromSingleTon
        require(msg.sender == address(this));
        dest.transfer(amount);
    }

    function exec(address dest, bytes calldata func) external {
        //callable only though execFromSingleTon
        require(msg.sender == address(this));
        (bool success,)=dest.call(func);
        require(success);
    }

    function updateSingleton(address singleton) external {
        require(msg.sender == this || msg.sender == owner);
        singleton = _singleton;
    }

    function payForSelfOp(UserOperation calldata userOp) external {
        require(msg.sender == singleton, "not from Singleton");
        require(owner == userOp.signer, "not owner");
        _validateSignature(userOp);
        _validateAndIncrementNonce(userOp);
        if (!userOp.hasPaymaster()) {
            msg.sender.transfer(userOp.requiredPreFund());
        }
    }

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external {
        require(msg.sender == singleton);
        this.call(func);
    }

    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        require(nonce++ == userOp.nonce, "invalid nonce");
    }

    function _validateSignature(UserOperations userOp) internal {
        bytes32 hash = userOp.hash();
        (bytes32 r, bytes32 s) = abi.decode(userOp.signature);
        uint8 v = userOp.signature[64];
        require(op.signer == ecrecover(hash, v, r, s));
    }

}


interface IPaymaster {

    // pre-pay for the call validate user operation, and if agrees to pay (from stake)
    // revert to reject this request.
    // @returns context value to send to a postOp
    //  value is zero to signify postOp is not required at all.
    function payForOp(UserOperation userOp) external returns (bytes memory context);

    // post-operation handler.
    //
    // @param context - the context value returned by payForOp
    // @param actualGasCost - actual gas used so far (without the postOp itself).
    function postOp(bytes memory context, uint actualGasCost) external;
}

contract Singleton {

    // actual stake value should be
    uint256 constant PAYMASTER_STAKE = 1 ether;
    //lock time for stake.
    uint256 constant STAKE_LOCK_BLOCKS = 100;

    uint256 MAX_CHECK_GAS = 100_000;
    uint256 POST_CALL_GAS_OVERHEAD = 50_000;

    event SuccessfulUserOperation(UserOperation op, bytes status);
    event FailedUserOperation(UserOperation op, bytes status);

    fallback () external payable {}
    function handleOps(UserOperation[] calldata ops) public {

        uint256 savedBalance = address(this).balance;
        uint256[] memory savedGas = new uint256(ops.length);
        bytes32[] memory contexts = new bytes32(ops.length);

        for (uint i = 0; i < ops.length; i++) {
            UserOperation calldata op = ops[i];
            validateGas(ops[i]);

            uint preGas = gasleft();
            contexts[i] = validatePrepayment(op);
            savedGas[i] = preGas - gasleft();
        }

        for (uint i = 0; i < ops.length; i++) {
            uint preGas = gasleft();
            UserOperation calldata op = ops[i];
            bytes32 context = contexts[i];
            (bool success, bytes memory status) = address(this).call(abi.encodeWithSelector(this.handleSingleOp, op, context, savedGas[i]));
            //TODO: capture original context
            if (!success) {
                uint actualGas = preGas - gasleft();
                handlePostOp(true, contexts, actualGasCost + savedGas[i]);
            }

            savedGas[i] += preGas - gasleft();
        }

        payable(address(msg.sender)).transfer(address(this).balance - savedBalance);
    }

    function handleSingleOp(UserOperation calldata op, bytes context, uint preOpCost) external {
        require(msg.sender == address(this));

        uint preGas = gasleft();
        (bool success, bytes memory status) = address(op.opData.target).call{gas : op.opData.callGas}(op.opData.callData);
        if (success) {
            emit SuccessfulUserOperation(op, status);
        }
        else {
            emit FailedUserOperation(op, status);
        }
        uint actualGasCost = preGas - gasleft() + preOpCost;
        handlePostOp(false, context, actualGasCost);
    }

    //validate it doesn't revert (paymaster, wallet validate request)
    //  has payment (from wallet: from paymaster we only make sure stake is enough)
    // accesslist should be used collected.
    function simulateOp(UserOperation calldata op) external {
        //make sure this method is only called off-chain
        require(msg.sender == address(0), "must be called off-chain with from=zero-addr");
        validatePrepayment(op);
    }

    uint tx_basefee = 0;

    function validateGas(UserOperation calldata op) internal {
        require(userOp.payData.maxGasFee <= tx.gasprice);
    }

    function validatePrepayment(UserOperation calldata op) private returns (bytes32 context){

        if (!op.hasPaymaster()) {
            preBalance = address(this).balance;
            IWallet(op.opData.target).payForSelfOp{gas : MAX_CHECK_GAS}(op);
            require(address(this).balance - preBalance >= op.requiredPreFund(), "wallet didn't pay prefund");
        } else {
            IWallet(op.opData.target).payForSelfOp{gas : MAX_CHECK_GAS}(op);
            require(isValidStake(op.payData.paymaster), "not enough stake");
            //no pre-pay from paymaster
            context = IPaymaster(op.payData.paymaster).payForOp{gas : MAX_CHECK_GAS}(op);
        }
    }

    function handlePostOp(bool postRevert, bytes memory context, uint actualGasCost) private {
        if (!op.hasPaymaster()) {
            //TODO: do we need postRevert for wallet?
            //NOTE: deliberately ignoring revert: wallet should accept refund.
            address(this).send(op.opData.target, op.requiredPreFund() - actualGasCost);
        } else {
            //paymaster balance known to be high enough, and to be locked for this block
            stakes[op.payData.paymaster] -= actualGasCost;
            if (context.length > 0) {
                IPaymaster(op.payData.paymaster).postOp(postRevert, context, actualGasCost);
            }
        }
    }

    function isValidStake(UserOperation calldata op) internal returns (bool) {
        if (canWithdrawStake(op.payData.paymaster))
            return false;
        return stakes[op.payData.paymaster] > op.requiredPreFund();
    }

    function canWithdrawStake(address paymaster) returns (bool) {
        return stakeDepositTime[paymaster] != 0 && stakeDepositTime[paymaster] + STAKE_LOCK_BLOCKS <= block.number;
    }

    function paymasterStake(address paymaster) payable {
        stakes[msg.sender] += msg.value;
        stakeDepositTime[msg.sender] = block.number;
        emit PaymasterStaked(msg.sender, msg.value);
    }

    function paymasterWithdrawStake(address withdrawAddress) {
        require(canWithdrawStake(msg.sender, "can't withdraw"));
        const stake = stakes[msg.sender];
        stakes[msg.sender] = 0;
        address(this).transfer(stake);
        emit StakeWithdrawn(msg.sender);
    }
}

