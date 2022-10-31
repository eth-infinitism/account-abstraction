/**
 ** Account-Abstraction (EIP-4337) singleton EntryPoint implementation.
 ** Only one instance required on each chain.
 **/
// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "../interfaces/IWallet.sol";
import "../interfaces/IPaymaster.sol";

import "../interfaces/IAggregatedWallet.sol";
import "../interfaces/IEntryPoint.sol";
import "../interfaces/ICreate2Deployer.sol";
import "../utils/Exec.sol";
import "./StakeManager.sol";
import "./SenderCreator.sol";

contract EntryPoint is IEntryPoint, StakeManager {

    using UserOperationLib for UserOperation;

    SenderCreator private immutable senderCreator = new SenderCreator();

    // internal value used during simulation: need to query aggregator if wallet is created
    address private constant SIMULATE_NO_AGGREGATOR = address(1);

    /**
     * @param _paymasterStake - minimum required locked stake for a paymaster
     * @param _unstakeDelaySec - minimum time (in seconds) a paymaster stake must be locked
     */
    constructor(uint256 _paymasterStake, uint32 _unstakeDelaySec) StakeManager(_paymasterStake, _unstakeDelaySec) {
        require(_unstakeDelaySec > 0, "invalid unstakeDelay");
        require(_paymasterStake > 0, "invalid paymasterStake");
    }

    /**
     * compensate the caller's beneficiary address with the collected fees of all UserOperations.
     * @param beneficiary the address to receive the fees
     * @param amount amount to transfer.
     */
    function _compensate(address payable beneficiary, uint256 amount) internal {
        require(beneficiary != address(0), "invalid beneficiary");
        (bool success,) = beneficiary.call{value : amount}("");
        require(success);
    }

    /**
     * execute a user op
     * @param opIndex into into the opInfo array
     * @param userOp the userOp to execute
     * @param opInfo the opInfo filled by validatePrepayment for this userOp.
     * @return collected the total amount this userOp paid.
     */
    function _executeUserOp(uint256 opIndex, UserOperation calldata userOp, UserOpInfo memory opInfo) private returns (uint256 collected) {
        uint256 preGas = gasleft();
        bytes memory context = getMemoryBytesFromOffset(opInfo.contextOffset);

        try this.innerHandleOp(userOp.callData, opInfo, context) returns (uint256 _actualGasCost) {
            collected = _actualGasCost;
        } catch {
            uint256 actualGas = preGas - gasleft() + opInfo.preOpGas;
            collected = _handlePostOp(opIndex, IPaymaster.PostOpMode.postOpReverted, opInfo, context, actualGas);
        }
    }

    /**
     * Execute a batch of UserOperation.
     * no signature aggregator is used.
     * if any wallet requires an aggregator (that is, it returned an "actualAggregator" when
     * performing simulateValidation), then handleAggregatedOps() must be used instead.
     * @param ops the operations to execute
     * @param beneficiary the address to receive the fees
     */
    function handleOps(UserOperation[] calldata ops, address payable beneficiary) public {

        uint256 opslen = ops.length;
        UserOpInfo[] memory opInfos = new UserOpInfo[](opslen);

    unchecked {
        for (uint256 i = 0; i < opslen; i++) {
            _validatePrepayment(i, ops[i], opInfos[i], address(0));
        }

        uint256 collected = 0;

        for (uint256 i = 0; i < opslen; i++) {
            collected += _executeUserOp(i, ops[i], opInfos[i]);
        }

        _compensate(beneficiary, collected);
    } //unchecked
    }

    /**
     * Execute a batch of UserOperation with Aggregators
     * @param opsPerAggregator the operations to execute, grouped by aggregator (or address(0) for no-aggregator wallets)
     * @param beneficiary the address to receive the fees
     */
    function handleAggregatedOps(
        UserOpsPerAggregator[] calldata opsPerAggregator,
        address payable beneficiary
    ) public {

        uint256 opasLen = opsPerAggregator.length;
        uint256 totalOps = 0;
        for (uint256 i = 0; i < opasLen; i++) {
            totalOps += opsPerAggregator[i].userOps.length;
        }

        UserOpInfo[] memory opInfos = new UserOpInfo[](totalOps);

        uint256 opIndex = 0;
        for (uint256 a = 0; a < opasLen; a++) {
            UserOpsPerAggregator calldata opa = opsPerAggregator[a];
            UserOperation[] calldata ops = opa.userOps;
            IAggregator aggregator = opa.aggregator;
            uint256 opslen = ops.length;
            for (uint256 i = 0; i < opslen; i++) {
                _validatePrepayment(opIndex, ops[i], opInfos[opIndex], address(aggregator));
                opIndex++;
            }

            if (address(aggregator) != address(0)) {
                // solhint-disable-next-line no-empty-blocks
                try aggregator.validateSignatures(ops, opa.signature) {}
                catch {
                    revert SignatureValidationFailed(address(aggregator));
                }
            }
        }

        uint256 collected = 0;
        opIndex = 0;
        for (uint256 a = 0; a < opasLen; a++) {
            UserOpsPerAggregator calldata opa = opsPerAggregator[a];
            UserOperation[] calldata ops = opa.userOps;
            uint256 opslen = ops.length;

            for (uint256 i = 0; i < opslen; i++) {
                collected += _executeUserOp(opIndex, ops[i], opInfos[opIndex]);
                opIndex++;
            }
        }

        _compensate(beneficiary, collected);
    }

    //a memory copy of UserOp fields (except that dynamic byte arrays: callData, initCode and signature
    struct MemoryUserOp {
        address sender;
        uint256 nonce;
        uint256 callGasLimit;
        uint256 verificationGasLimit;
        uint256 preVerificationGas;
        address paymaster;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
    }

    struct UserOpInfo {
        MemoryUserOp mUserOp;
        bytes32 requestId;
        uint256 prefund;
        uint256 contextOffset;
        uint256 preOpGas;
    }

    /**
     * inner function to handle a UserOperation.
     * Must be declared "external" to open a call context, but it can only be called by handleOps.
     */
    function innerHandleOp(bytes calldata callData, UserOpInfo memory opInfo, bytes calldata context) external returns (uint256 actualGasCost) {
        uint256 preGas = gasleft();
        require(msg.sender == address(this));
        MemoryUserOp memory mUserOp = opInfo.mUserOp;

        IPaymaster.PostOpMode mode = IPaymaster.PostOpMode.opSucceeded;
        if (callData.length > 0) {

            (bool success,bytes memory result) = address(mUserOp.sender).call{gas : mUserOp.callGasLimit}(callData);
            if (!success) {
                if (result.length > 0) {
                    emit UserOperationRevertReason(opInfo.requestId, mUserOp.sender, mUserOp.nonce, result);
                }
                mode = IPaymaster.PostOpMode.opReverted;
            }
        }

    unchecked {
        uint256 actualGas = preGas - gasleft() + opInfo.preOpGas;
        //note: opIndex is ignored (relevant only if mode==postOpReverted, which is only possible outside of innerHandleOp)
        return _handlePostOp(0, mode, opInfo, context, actualGas);
    }
    }

    /**
     * generate a request Id - unique identifier for this request.
     * the request ID is a hash over the content of the userOp (except the signature), the entrypoint and the chainid.
     */
    function getRequestId(UserOperation calldata userOp) public view returns (bytes32) {
        return keccak256(abi.encode(userOp.hash(), address(this), block.chainid));
    }

    /**
     * copy general fields from userOp into the memory opInfo structure.
     */
    function _copyUserOpToMemory(UserOperation calldata userOp, MemoryUserOp memory mUserOp) internal pure {
        mUserOp.sender = userOp.sender;
        mUserOp.nonce = userOp.nonce;
        mUserOp.callGasLimit = userOp.callGasLimit;
        mUserOp.verificationGasLimit = userOp.verificationGasLimit;
        mUserOp.preVerificationGas = userOp.preVerificationGas;
        mUserOp.maxFeePerGas = userOp.maxFeePerGas;
        mUserOp.maxPriorityFeePerGas = userOp.maxPriorityFeePerGas;
        bytes calldata paymasterAndData = userOp.paymasterAndData;
        if (paymasterAndData.length > 0) {
            require(paymasterAndData.length >= 20, "invalid paymasterAndData");
            mUserOp.paymaster = address(bytes20(paymasterAndData[: 20]));
        } else {
            mUserOp.paymaster = address(0);
        }
    }

    /**
    * Simulate a call to wallet.validateUserOp and paymaster.validatePaymasterUserOp.
    * Validation succeeds if the call doesn't revert.
    * @dev The node must also verify it doesn't use banned opcodes, and that it doesn't reference storage outside the wallet's data.
     *      In order to split the running opcodes of the wallet (validateUserOp) from the paymaster's validatePaymasterUserOp,
     *      it should look for the NUMBER opcode at depth=1 (which itself is a banned opcode)
     * @param userOp the user operation to validate.
     * @param offChainSigCheck if the wallet has an aggregator, skip on-chain aggregation check. In thus case, the bundler must
     *          perform the equivalent check using an off-chain library code
     * @return preOpGas total gas used by validation (including contract creation)
     * @return prefund the amount the wallet had to prefund (zero in case a paymaster pays)
     * @return deadline until what time this userOp is valid (the minimum value of wallet and paymaster's deadline)
     * @return actualAggregator the aggregator used by this userOp. if a non-zero aggregator is returned, the bundler must get its params using
     *      aggregator.
     * @return sigForUserOp - only if has actualAggregator: this value is returned from IAggregator.validateUserOpSignature, and should be placed in the userOp.signature when creating a bundle.
     * @return sigForAggregation  - only if has actualAggregator:  this value is returned from IAggregator.validateUserOpSignature, and should be passed to aggregator.aggregateSignatures
     * @return offChainSigInfo - if has actualAggregator, and offChainSigCheck is true, this value should be used by the off-chain signature code (e.g. it contains the sender's publickey)
     */
    function simulateValidation(UserOperation calldata userOp, bool offChainSigCheck)
    external returns (uint256 preOpGas, uint256 prefund, uint256 deadline, address actualAggregator, bytes memory sigForUserOp, bytes memory sigForAggregation, bytes memory offChainSigInfo) {
        uint256 preGas = gasleft();

        UserOpInfo memory outOpInfo;

        (actualAggregator, deadline) = _validatePrepayment(0, userOp, outOpInfo, SIMULATE_NO_AGGREGATOR);
        prefund = outOpInfo.prefund;
        preOpGas = preGas - gasleft() + userOp.preVerificationGas;

        numberMarker();
        if (actualAggregator != address(0)) {
            (sigForUserOp, sigForAggregation, offChainSigInfo) = IAggregator(actualAggregator).validateUserOpSignature(userOp, offChainSigCheck);
        }
        require(msg.sender == address(0), "must be called off-chain with from=zero-addr");
    }

    function _getRequiredPrefund(MemoryUserOp memory mUserOp) internal view returns (uint256 requiredPrefund) {
    unchecked {
        //when using a Paymaster, the verificationGasLimit is used also to as a limit for the postOp call.
        // our security model might call postOp eventually twice
        uint256 mul = mUserOp.paymaster != address(0) ? 3 : 1;
        uint256 requiredGas = mUserOp.callGasLimit + mUserOp.verificationGasLimit * mul + mUserOp.preVerificationGas;

        // TODO: copy logic of gasPrice?
        requiredPrefund = requiredGas * getUserOpGasPrice(mUserOp);
    }
    }

    // create the sender's contract if needed.
    function _createSenderIfNeeded(uint256 opIndex, MemoryUserOp memory mUserOp, bytes calldata initCode) internal {
        if (initCode.length != 0) {
            if (mUserOp.sender.code.length != 0) revert FailedOp(opIndex, address(0), "sender already constructed");
            address sender1 = senderCreator.createSender(initCode);
            if (sender1 == address(0)) revert FailedOp(opIndex, address(0), "initCode failed");
            if (sender1 != mUserOp.sender) revert FailedOp(opIndex, address(0), "sender doesn't match initCode address");
            if (sender1.code.length == 0) revert FailedOp(opIndex, address(0), "initCode failed to create sender");
        }
    }

    /**
     * helper: make a "view" call to calculate the sender address.
     * must be called from zero-address.
     */
    function getSenderAddress(bytes calldata initCode) public returns (address sender) {
        require(msg.sender == address(0), "must be called off-chain with from=zero-addr");
        return senderCreator.createSender(initCode);
    }

    /**
     * call wallet.validateUserOp.
     * revert (with FailedOp) in case validateUserOp reverts, or wallet didn't send required prefund.
     * decrement wallet's deposit if needed
     */
    function _validateWalletPrepayment(uint256 opIndex, UserOperation calldata op, UserOpInfo memory opInfo, address aggregator, uint256 requiredPrefund)
    internal returns (uint256 gasUsedByValidateWalletPrepayment, address actualAggregator, uint256 deadline) {
    unchecked {
        uint256 preGas = gasleft();
        MemoryUserOp memory mUserOp = opInfo.mUserOp;
        _createSenderIfNeeded(opIndex, mUserOp, op.initCode);
        if (aggregator == SIMULATE_NO_AGGREGATOR) {
            try IAggregatedWallet(mUserOp.sender).getAggregator() returns (address userOpAggregator) {
                aggregator = actualAggregator = userOpAggregator;
            } catch {
                aggregator = actualAggregator = address(0);
            }
        }
        uint256 missingWalletFunds = 0;
        address sender = mUserOp.sender;
        address paymaster = mUserOp.paymaster;
        if (paymaster == address(0)) {
            uint256 bal = balanceOf(sender);
            missingWalletFunds = bal > requiredPrefund ? 0 : requiredPrefund - bal;
        }
        try IWallet(sender).validateUserOp{gas : mUserOp.verificationGasLimit}(op, opInfo.requestId, aggregator, missingWalletFunds) returns (uint256 _deadline) {
            // solhint-disable-next-line not-rely-on-time
            if (_deadline != 0 && _deadline < block.timestamp) {
                revert FailedOp(opIndex, address(0), "expired");
            }
            deadline = _deadline;
        } catch Error(string memory revertReason) {
            revert FailedOp(opIndex, address(0), revertReason);
        } catch {
            revert FailedOp(opIndex, address(0), "");
        }
        if (paymaster == address(0)) {
            DepositInfo storage senderInfo = deposits[sender];
            uint256 deposit = senderInfo.deposit;
            if (requiredPrefund > deposit) {
                revert FailedOp(opIndex, address(0), "wallet didn't pay prefund");
            }
            senderInfo.deposit = uint112(deposit - requiredPrefund);
        }
        gasUsedByValidateWalletPrepayment = preGas - gasleft();
    }
    }

    /**
     * in case the request has a paymaster:
     * validate paymaster is staked and has enough deposit.
     * call paymaster.validatePaymasterUserOp.
     * revert with proper FailedOp in case paymaster reverts.
     * decrement paymaster's deposit
     */
    function _validatePaymasterPrepayment(uint256 opIndex, UserOperation calldata op, UserOpInfo memory opInfo, uint256 requiredPreFund, uint256 gasUsedByValidateWalletPrepayment) internal returns (bytes memory context, uint256 deadline) {
    unchecked {
        MemoryUserOp memory mUserOp = opInfo.mUserOp;
        address paymaster = mUserOp.paymaster;
        DepositInfo storage paymasterInfo = deposits[paymaster];
        uint256 deposit = paymasterInfo.deposit;
        bool staked = paymasterInfo.staked;
        if (!staked) {
            revert FailedOp(opIndex, paymaster, "not staked");
        }
        if (deposit < requiredPreFund) {
            revert FailedOp(opIndex, paymaster, "paymaster deposit too low");
        }
        paymasterInfo.deposit = uint112(deposit - requiredPreFund);
        uint256 gas = mUserOp.verificationGasLimit - gasUsedByValidateWalletPrepayment;
        try IPaymaster(paymaster).validatePaymasterUserOp{gas : gas}(op, opInfo.requestId, requiredPreFund) returns (bytes memory _context, uint256 _deadline){
            // solhint-disable-next-line not-rely-on-time
            if (_deadline != 0 && _deadline < block.timestamp) {
                revert FailedOp(opIndex, paymaster, "expired");
            }
            context = _context;
            deadline = _deadline;
        } catch Error(string memory revertReason) {
            revert FailedOp(opIndex, paymaster, revertReason);
        } catch {
            revert FailedOp(opIndex, paymaster, "");
        }
    }
    }

    /**
     * validate wallet and paymaster (if defined).
     * also make sure total validation doesn't exceed verificationGasLimit
     * this method is called off-chain (simulateValidation()) and on-chain (from handleOps)
     * @param opIndex the index of this userOp into the "opInfos" array
     * @param userOp the userOp to validate
     */
    function _validatePrepayment(uint256 opIndex, UserOperation calldata userOp, UserOpInfo memory outOpInfo, address aggregator)
    private returns (address actualAggregator, uint256 deadline) {

        uint256 preGas = gasleft();
        MemoryUserOp memory mUserOp = outOpInfo.mUserOp;
        _copyUserOpToMemory(userOp, mUserOp);
        outOpInfo.requestId = getRequestId(userOp);

        // validate all numeric values in userOp are well below 128 bit, so they can safely be added
        // and multiplied without causing overflow
        uint256 maxGasValues = mUserOp.preVerificationGas | mUserOp.verificationGasLimit | mUserOp.callGasLimit |
        userOp.maxFeePerGas | userOp.maxPriorityFeePerGas;
        require(maxGasValues <= type(uint120).max, "gas values overflow");

        uint256 gasUsedByValidateWalletPrepayment;
        (uint256 requiredPreFund) = _getRequiredPrefund(mUserOp);
        (gasUsedByValidateWalletPrepayment, actualAggregator, deadline) = _validateWalletPrepayment(opIndex, userOp, outOpInfo, aggregator, requiredPreFund);
        //a "marker" where wallet opcode validation is done and paymaster opcode validation is about to start
        // (used only by off-chain simulateValidation)
        numberMarker();

        bytes memory context;
        if (mUserOp.paymaster != address(0)) {
            uint paymasterDeadline;
            (context, paymasterDeadline) = _validatePaymasterPrepayment(opIndex, userOp, outOpInfo, requiredPreFund, gasUsedByValidateWalletPrepayment);
            if (paymasterDeadline != 0 && paymasterDeadline < deadline) {
                deadline = paymasterDeadline;
            }
        } else {
            context = "";

        }
    unchecked {
        uint256 gasUsed = preGas - gasleft();

        if (userOp.verificationGasLimit < gasUsed) {
            revert FailedOp(opIndex, mUserOp.paymaster, "Used more than verificationGasLimit");
        }
        outOpInfo.prefund = requiredPreFund;
        outOpInfo.contextOffset = getOffsetOfMemoryBytes(context);
        outOpInfo.preOpGas = preGas - gasleft() + userOp.preVerificationGas;
    }
    }

    /**
     * process post-operation.
     * called just after the callData is executed.
     * if a paymaster is defined and its validation returned a non-empty context, its postOp is called.
     * the excess amount is refunded to the wallet (or paymaster - if it is was used in the request)
     * @param opIndex index in the batch
     * @param mode - whether is called from innerHandleOp, or outside (postOpReverted)
     * @param opInfo userOp fields and info collected during validation
     * @param context the context returned in validatePaymasterUserOp
     * @param actualGas the gas used so far by this user operation
     */
    function _handlePostOp(uint256 opIndex, IPaymaster.PostOpMode mode, UserOpInfo memory opInfo, bytes memory context, uint256 actualGas) private returns (uint256 actualGasCost) {
        uint256 preGas = gasleft();
    unchecked {
        address refundAddress;
        MemoryUserOp memory mUserOp = opInfo.mUserOp;
        uint256 gasPrice = getUserOpGasPrice(mUserOp);

        address paymaster = mUserOp.paymaster;
        if (paymaster == address(0)) {
            refundAddress = mUserOp.sender;
        } else {
            refundAddress = paymaster;
            if (context.length > 0) {
                actualGasCost = actualGas * gasPrice;
                if (mode != IPaymaster.PostOpMode.postOpReverted) {
                    IPaymaster(paymaster).postOp{gas : mUserOp.verificationGasLimit}(mode, context, actualGasCost);
                } else {
                    // solhint-disable-next-line no-empty-blocks
                    try IPaymaster(paymaster).postOp{gas : mUserOp.verificationGasLimit}(mode, context, actualGasCost) {}
                    catch Error(string memory reason) {
                        revert FailedOp(opIndex, paymaster, reason);
                    }
                    catch {
                        revert FailedOp(opIndex, paymaster, "postOp revert");
                    }
                }
            }
        }
        actualGas += preGas - gasleft();
        actualGasCost = actualGas * gasPrice;
        if (opInfo.prefund < actualGasCost) {
            revert FailedOp(opIndex, paymaster, "prefund below actualGasCost");
        }
        uint256 refund = opInfo.prefund - actualGasCost;
        internalIncrementDeposit(refundAddress, refund);
        bool success = mode == IPaymaster.PostOpMode.opSucceeded;
        emit UserOperationEvent(opInfo.requestId, mUserOp.sender, mUserOp.paymaster, mUserOp.nonce, actualGasCost, gasPrice, success);
    } // unchecked
    }

    /**
     * return the storage cells used internally by the EntryPoint for this sender address.
     * During `simulateValidation`, allow these storage cells to be accessed
     *  (that is, a wallet/paymaster are allowed to access their own deposit balance on the
     *  EntryPoint's storage, but no other account)
     */
    function getSenderStorage(address sender) external view returns (uint256[] memory senderStorageCells) {
        uint256 cell;
        DepositInfo storage info = deposits[sender];

        assembly {
            cell := info.slot
        }
        senderStorageCells = new uint256[](1);
        senderStorageCells[0] = cell;
    }

    /**
     * the gas price this UserOp agrees to pay.
     * relayer/miner might submit the TX with higher priorityFee, but the user should not
     */
    function getUserOpGasPrice(MemoryUserOp memory mUserOp) internal view returns (uint256) {
    unchecked {
        uint256 maxFeePerGas = mUserOp.maxFeePerGas;
        uint256 maxPriorityFeePerGas = mUserOp.maxPriorityFeePerGas;
        if (maxFeePerGas == maxPriorityFeePerGas) {
            //legacy mode (for networks that don't support basefee opcode)
            return maxFeePerGas;
        }
        return min(maxFeePerGas, maxPriorityFeePerGas + block.basefee);
    }
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function getOffsetOfMemoryBytes(bytes memory data) internal pure returns (uint256 offset) {
        assembly {offset := data}
    }

    function getMemoryBytesFromOffset(uint256 offset) internal pure returns (bytes memory data) {
        assembly {data := offset}
    }

    //place the NUMBER opcode in the code.
    // this is used as a marker during simulation, as this OP is completely banned from the simulated code of the
    // wallet and paymaster.
    function numberMarker() internal view {
        assembly {mstore(0, number())}
    }
}

