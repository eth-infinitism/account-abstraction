// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

contract Singleton {
    
    uint256 MAX_CHECK_GAS = 100_000;
    uint256 POST_CALL_GAS_OVERHEAD = 50_000;
    
    struct UserOperation {
        bytes20 target;
        uint64 callGas;
        uint64 postCallGas;
        uint256 gasPrice;
        bytes callData;
        bytes signature;
    }
    
    event SuccessfulUserOperation(UserOperation op, bytes status);
    event FailedUserOperation(UserOperation op, bytes status);
    
    function handleOps(UserOperation[] calldata ops, uint256 minimumGasPrice) public {
        //require(msg.sender == block.coinbase);
        uint256 savedBalance = address(this).balance;
        for(uint i=0;i<ops.length;i++){
            UserOperation calldata op = ops[i];
            if (gasleft() <= op.callGas + op.postCallGas + MAX_CHECK_GAS + POST_CALL_GAS_OVERHEAD){
                break;
            }
            (bool success, bytes memory status) = address(this).call(
                abi.encodeWithSelector(this.handleOp.selector, op, minimumGasPrice)
            );
            if (success) {s
                emit SuccessfulUserOperation(op, status);
            }
            else {
                emit FailedUserOperation(op, status);
            }
            
        }
        payable(address(msg.sender)).transfer(address(this).balance-savedBalance);
    }
    
    function handleOp(UserOperation calldata op, uint256 minimumGasPrice) public {
        uint256 savedGas = gasleft();
        
        require(op.gasPrice >= minimumGasPrice);
        require(gasleft()-op.callGas+op.postCallGas >= POST_CALL_GAS_OVERHEAD);
        
        ISmartContractWallet smartContractWallet = ISmartContractWallet(address(op.target));
        smartContractWallet.payForOp{gas:MAX_CHECK_GAS}(op.callGas, op.postCallGas, op.callData, op.signature);
        
        require(address(this).balance >= op.gasPrice*(op.callGas+op.postCallGas));
        (bool success,) = address(smartContractWallet).call{gas:op.callGas}(op.callData);
        require(success);
        smartContractWallet.handleRefundGas{gas:op.postCallGas,value:(savedGas-gasleft()-op.postCallGas)*tx.gasprice};
    }
}

interface ISmartContractWallet {
    
    // callGas, postCallGas, callData, signature
    function payForOp(uint64, uint64, bytes calldata, bytes calldata) external;
    
    function handleRefundGas() payable external;
}