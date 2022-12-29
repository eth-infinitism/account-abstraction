// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable no-inline-assembly */

// EIP4337是我们集体走向账户抽象之旅的最新主张，它可以被视为智能合约钱包的演变。在高层次上，它通过共同化所需的一些链上和链下基础设施，使在以太坊上编写和操作智能合约钱包变得更加简单。

// 使用EIP4337，用户不再进行交易。相反，他们将用户操作发送到更高级别的内存池。矿工或捆绑商可以将一组UserOperation打包成一个捆绑交易，该交易被发送到EntryPoint合约执行。EntryPoint合约协调操作的正确执行，并确保矿工/捆绑者得到适当的交易费用补偿。

// 使用 EIP4337，任何开发人员都可以用几行代码编写自定义智能合约钱包，而不必关心如何补贴交易费用。

// 与智能合约钱包一样，EIP4337 旨在模拟 AA，而无需对协议进行任何更改。但与智能合约钱包一样，EIP4337并没有摆脱EOA，建立在EIP4337之上的钱包仍然是以太坊上的二等公民。

// 参考文档：
// https://medium.com/infinitism/erc-4337-account-abstraction-without-ethereum-protocol-changes-d75c9d94dc4a
// http://www.dlebanontao.com/aa/3778.html
// https://github.com/eth-infinitism/account-abstraction/pull/92
// https://mirror.xyz/0xf05eAD2Bdd2766A9ed0ef5269A2B13Dda8aB950F/ZNs929Oe_0C_BxJKEMi3ndw8TBgEKd13dcPoylkQRJs
// https://news.marsbit.co/20221019080855548972.html
/**
*用户操作结构
*@param sender 本次请求的发起人钱包地址
*@param nonce 发送者用来验证它不是重播的唯一值。和我们之前钱包的 nonce 值一样，会按照 nonce 严格执行
*@param initCode 如果设置，账户合约将由此构造函数创建，如果钱包尚不存在，则用于创建钱包的初始化代码
*@param callData 要在此帐户上执行的方法调用，实际执行步骤用什么数据调用钱包
*@param verificationGasLimit gas 用于 validateUserOp 和 validatePaymasterUserOp。 验证交易时的gasLimit
*@param preVerificationGas gas 不是通过 handleOps 方法计算的，而是添加到支付的 gas 中。 补偿bundler调用handleOps时会一部分未计算在内的gas成本（如提交交易的calldata成本）。
*@param maxFeePerGas 与 EIP-1559 gas 参数相同，每个 gas 最高费用
*@param maxPriorityFeePerGas 与 EIP-1559 gas 参数相同
*@param paymasterAndData 可选，可以设置代付款人的地址
*@param signature “nonce”和“signature”字段的使用不是由协议定义的，而是由每个钱包实现定义。signature可以是任意类型签名，为防止重放攻击（跨链和多个EntryPoint 实现），signature应该依赖于chainid 和EntryPoint地址。
*/
struct UserOperation {

    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

library UserOperationLib {

    /**
    * 获取 userOp 本次请求的发起人钱包地址，类似 msg.sender
    */
    function getSender(UserOperation calldata userOp) internal pure returns (address) {
        address data;
        //从 userOp 读取发送者，它是第一个 userOp 成员（节省 800 gas ...）
        assembly {data := calldataload(userOp)}
        return address(uint160(data));
    }

    //relayer/block builder might submit the TX with higher priorityFee, but the user should not
    // pay above what he signed for.
    function gasPrice(UserOperation calldata userOp) internal view returns (uint256) {
    unchecked {
        uint256 maxFeePerGas = userOp.maxFeePerGas;
        uint256 maxPriorityFeePerGas = userOp.maxPriorityFeePerGas;
        if (maxFeePerGas == maxPriorityFeePerGas) {
            //legacy mode (for networks that don't support basefee opcode)
            return maxFeePerGas;
        }
        return min(maxFeePerGas, maxPriorityFeePerGas + block.basefee);
    }
    }

    function pack(UserOperation calldata userOp) internal pure returns (bytes memory ret) {
        //lighter signature scheme. must match UserOp.ts#packUserOp
        bytes calldata sig = userOp.signature;
        // copy directly the userOp from calldata up to (but not including) the signature.
        // this encoding depends on the ABI encoding of calldata, but is much lighter to copy
        // than referencing each field separately.
        assembly {
            let ofs := userOp
            let len := sub(sub(sig.offset, ofs), 32)
            ret := mload(0x40)
            mstore(0x40, add(ret, add(len, 32)))
            mstore(ret, len)
            calldatacopy(add(ret, 32), ofs, len)
        }
    }

    function hash(UserOperation calldata userOp) internal pure returns (bytes32) {
        return keccak256(pack(userOp));
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
