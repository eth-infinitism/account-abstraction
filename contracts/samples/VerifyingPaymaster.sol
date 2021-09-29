// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "../IPaymaster.sol";
import "../EntryPoint.sol";

/**
 * A sample paymaster that uses external service to decide whether to pay for the UserOp.
 * The paymaster trusts an external signer to sign the transaction.
 * The calling user must pass the UserOp to that external signer first, which performs
 * whatever off-chain verification before signing the UserOp.
 * Note that this signature is NOT a replacement for wallet signature:
 * - the paymaster signs to agree to PAY for GAS.
 * - the wallet signs to prove identity and wallet ownership.
 */
contract VerifyingPaymaster is IPaymaster {

    using UserOperationLib for UserOperation;

    EntryPoint public immutable entryPoint;
    address public immutable verifyingSigner;

    constructor(EntryPoint _entryPoint, address _verifyingSigner) {
        entryPoint = _entryPoint;
        verifyingSigner = _verifyingSigner;
    }

    function addStake() external payable {
        entryPoint.addStake{value : msg.value}();
    }

    // verify our external signer signed this request.
    // the "paymasterData" is supposed to be a signature over the entire request params
    function verifyPaymasterUserOp(UserOperation calldata userOp, uint requiredPreFund) external view override returns (bytes memory context) {
        (requiredPreFund);

        bytes32 hash = userOp.hash();
        require( userOp.paymasterData.length >= 65, "VerifyingPaymaster: invalid signature length in paymasterData");
        (bytes32 r, bytes32 s) = abi.decode(userOp.paymasterData, (bytes32, bytes32));
        uint8 v = uint8(userOp.paymasterData[64]);
        require(verifyingSigner == ecrecover(hash, v, r, s), "VerifyingPaymaster: wrong signature");

        //no other on-chain validation: entire UserOp should have been checked by the external service,
        // prior signing it.
        return "";
    }

    function postOp(PostOpMode, bytes calldata, uint) external pure override {
        //should never get called. returned "0" from verifyPaymasterUserOp
        revert();
    }
}
