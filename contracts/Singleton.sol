// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

struct UserOperation {
    address target;
    address paymaster;
    uint256 nonce;
    uint64 callGas;
    uint64 postCallGas;
    uint64 gasPrice;
    bytes callData;
    bytes signature;
}

library UserOperationLib {
    function requiredPreFund(UserOperation calldata userOp) internal returns (uint) {
        //TODO: does paymaster has extra gas?
        return userOp.callGas * userOp.gasPrice;
    }

    function clientPrePay(UserOperation calldata userOp) internal returns (uint){
        if (hasPaymaster(userOp))
            return 0;
        return requiredPreFund(userOp);
    }

    function hasPaymaster(UserOperation calldata userOp) internal returns (bool) {
        return userOp.paymaster != address(0);
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
    function payForSelfOp(UserOperation userOp) external {
        require( nonce++ == userOp.nonce, "invalid nonce");
        if ( !userOp.hasPaymaster() ) {
            msg.sender.transfer(userOp.requiredPreFund());
        }
    }

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external {
        require( msg.sender == SINGLETON_ADDRESS);
        this.call(func);
    }
}


interface IPaymaster {

    // pre-pay for the call validate user operation, and if agrees to pay (from stake)
    function payForOp(UserOperation userOp) external returns (bytes memory context);

    // post-operation handler.
    //
    // @param context - the context value returned by payForOp
    // @param actualGasCost - lower than the original maxPay
    function postOp(bytes memory context, uint actualGasCost) external;
}

contract Singleton {

    // must be higher than max TX cost
    uint256 constant PAYMASTER_STAKE = 1 ether;
    //lock time for stake.
    uint256 constant STAKE_LOCK_BLOCKS = 100;

    uint256 MAX_CHECK_GAS = 100_000;
    uint256 POST_CALL_GAS_OVERHEAD = 50_000;

    event SuccessfulUserOperation(UserOperation op, bytes status);
    event FailedUserOperation(UserOperation op, bytes status);

    function handleOps(UserOperation[] calldata ops) public {

        uint256 savedBalance = address(this).balance;
        uint256[] memory savedGas;

        for (uint i = 0; i < ops.length; i++) {
            UserOperation calldata op = ops[i];

            uint preGas = gasleft();
            validatePrepayment(op);
            savedGas[i] = preGas - gasleft();
        }

        for (uint i = 0; i < ops.length; i++) {
            uint preGas = gasleft();
            UserOperation calldata op = ops[i];
            (bool success, bytes memory status) = address(this).call(abi.encodeWithSelector(this.handleSingleOp, op));
            //TODO: capture original context
            bytes memory context = "";
            handlePostOp(false, context, preGas-gasleft()+savedGas[i]);

            savedGas[i] += preGas-gasleft();
        }

        payable(address(msg.sender)).transfer(address(this).balance - savedBalance);
    }

    function handleSingleOp(UserOperation calldata op) external {
        require(msg.sender == address(this));

        (bool success, bytes memory status) = address(op.target).call{gas : op.callGas}(op.callData);
        if (success) {
            emit SuccessfulUserOperation(op, status);
        }
        else {
            emit FailedUserOperation(op, status);
        }

        if ( op.hasPaymaster()) {
            handlePostOp(op);
        }
    }

    //validate it doesn't revert (paymaster, wallet validate request)
    //  has payment (from wallet: from paymaster we only make sure stake is enough)
    // accesslist should be used collected.
    function simulateOp(UserOperation calldata op) external {
        validatePrepayment(op);
    }

    function validatePrepayment(UserOperation calldata op) private {

        if (!op.hasPaymaster()) {
            preBalance = address(this).balance;
            IWallet(op.target).payForSelfOp{gas : MAX_CHECK_GAS}(op);
            require(address(this).balance - preBalance >= op.requiredPreFund(), "wallet didn't pay prefund");
        } else {
            IWallet(op.target).payForSelfOp{gas : MAX_CHECK_GAS}(op);
            require(isValidStake(op.paymaster), "not enough stake");
            //no pre-pay from paymaster
            IPaymaster(op.paymaster).payForOp{gas:MAX_CHECK_GAS}(op);
        }
    }

    function handlePostOp(bytes memory context, uint actualGasCost) private {
        if (!op.hasPaymaster()) {
            //NOTE: deliberately ignoring revert: wallet should accept refund.
            address(this).send(op.target, actualGasCost-op.requiredPreFund());
        } else {
            //paymaster balance known to be high enough, and to be locked for this block
            stakes[op.paymaster] -= actualGasCost;
            if (context.length>0) {
                IPaymaster(op.paymaster).postOp(context, actualGasCost);
            }
        }
    }

    function isValidStake(UserOperation calldata op) internal returns (bool) {
        if (canWithdrawStake(op.paymaster))
            return false;
        return stakes[op.paymaster] > op.requiredPreFund();
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

