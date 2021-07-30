// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

contract Singleton {
    
    uint256 MAX_CHECK_GAS = 100_000;
    uint256 POST_CALL_GAS_OVERHEAD = 50_000;
    
    struct UserOperation {
        bytes20 target;
        bytes20 paymaster;
        uint256 nonce;
        uint64 callGas;
        uint64 postCallGas;
        uint256 gasPrice;
        bytes callData;
        bytes signature;
    }

    event SuccessfulUserOperation(UserOperation op, bytes status);
    event FailedUserOperation(UserOperation op, bytes status);
    
    function handleOps(UserOperation[] calldata ops) public {

        uint256 savedBalance = address(this).balance;
        uint256[] memory savedGas;
        
        for(uint i=0;i<ops.length;i++){
            UserOperation calldata op = ops[i];
            
            savedGas[i] = gasleft();
            
            IPayMaster paymaster = IPayMaster(address(op.paymaster));
            bool adequatePaymentReceived = _requestPayment(op, paymaster, address(this).balance);
            require(adequatePaymentReceived);
            
            savedGas[i] -= gasleft();
        }
        
        for(uint i=0;i<ops.length;i++){
            savedGas[i] += gasleft();
            UserOperation calldata op = ops[i];
            (bool success, bytes memory status) = address(op.target).call{gas:op.callGas}(op.callData);
            
            if (success) {
                emit SuccessfulUserOperation(op, status);
            }
            else {
                emit FailedUserOperation(op, status);
            }
            savedGas[i] -= gasleft();
        }
        
        for(uint i=0;i<ops.length;i++){
            savedGas[i] += gasleft();
            UserOperation calldata op = ops[i];
            
            IPayMaster paymaster = IPayMaster(address(op.paymaster));
            bytes memory refundCallData = abi.encodeWithSelector(paymaster.handleRefundGas.selector, op.target, op.nonce, op.callGas, op.postCallGas, op.gasPrice, op.callData, op.signature);
            
            address(op.paymaster).call{gas:op.postCallGas,value:(savedGas[i]-gasleft()-op.postCallGas)*tx.gasprice}(refundCallData);
        }
        
        payable(address(msg.sender)).transfer(address(this).balance-savedBalance);
    }
    
    function simulateOp(UserOperation calldata op) external {
        IPayMaster paymaster = IPayMaster(address(op.paymaster));
        if (_requestPayment(op, paymaster, address(this).balance)) {
            revert("success");
        }
        revert("failure");
    }
    
    function _requestPayment(UserOperation calldata op, IPayMaster paymaster, uint256 savedBalance) private returns (bool) {
        require(gasleft()-op.callGas+op.postCallGas >= POST_CALL_GAS_OVERHEAD);
        
        paymaster.payForOp{gas:MAX_CHECK_GAS}(op.target, op.nonce, op.callGas, op.postCallGas, op.gasPrice, op.callData, op.signature);
        if (address(this).balance - savedBalance >= op.gasPrice*(op.callGas+op.postCallGas)){
            return true;
        }
        return false;
    }
}

interface IPayMaster {
    
    // target, nonce, callGas, postCallGas, gasPrice, callData, signature
    function payForOp(bytes20, uint256, uint64, uint64, uint256, bytes calldata, bytes calldata) external;
    
    function handleRefundGas(bytes20, uint256, uint64, uint64, uint256, bytes calldata, bytes calldata) payable external;
}