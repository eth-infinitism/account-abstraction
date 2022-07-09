//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;
pragma abicoder v2;

import "../IAggregator.sol";
import {BLSOpen} from  "./lib/BLSOpen.sol";
import "./IBLSWallet.sol";

/**
 * A BLS-based signature aggregator, to validate aggregated signature of multiple UserOps if BLSWallet
 */
contract BLSSignatureAggregator is IAggregator {
    using UserOperationLib for UserOperation;

    bytes32 public constant BLS_DOMAIN = keccak256("eip4337.bls.domain");

    function validateSignatures(UserOperation[] calldata userOps, bytes calldata signature)
    external view override {
        require(signature.length == 64, "BLSSignatureAggregator: invalid signature");
        (uint256[2] memory blsSignature) = abi.decode(signature, (uint256[2]));
        uint len = userOps.length;
        uint256[4][] memory blsPublicKeys = new uint256[4][](len);
        uint256[2][] memory messages = new uint256[2][](len);
        for (uint256 i = 0; i < len; i++) {
            UserOperation memory userOp = userOps[i];
            IBLSWallet blsWallet = IBLSWallet(userOp.sender);
            blsPublicKeys[i] = blsWallet.getBlsPublicKey{gas : 5000}();
            messages[i] = userOpToMessage(userOp);
        }
        require(BLSOpen.verifyMultiple(blsSignature, blsPublicKeys, messages), "BLSSignatureAggregator: failed");
    }

    /**
     * get a hash of userOp
     * NOTE: this hash is not the same as UserOperation.hash()
     */
    function getUserOpHash(UserOperation memory userOp) public pure returns (bytes32) {
        return keccak256(abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGas,
                userOp.verificationGas,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                userOp.paymaster,
                keccak256(userOp.paymasterData)
            ));
    }

    /**
     * return the BLS "message" for the given UserOp.
     * the wallet should sign this value using its public-key
     */
    function userOpToMessage(UserOperation memory userOp) public view returns (uint256[2] memory) {
        // requestId same as entryPoint.getRequestId()
        bytes32 requestId = keccak256(abi.encode(getUserOpHash(userOp), address(this), block.chainid));
        return BLSOpen.hashToPoint(BLS_DOMAIN, abi.encodePacked(requestId));
    }

    /**
     * validate signature of a single userOp
     * This method is called after EntryPoint.simulateUserOperation() returns an aggregator.
     * First it validates the signature over the userOp. then it return data to be used when creating the handleOps:
     * @param userOp the userOperation received from the user.
     * @return sigForUserOp the value to put into the signature field of the userOp when calling handleOps.
     *    (usually empty, unless wallet and aggregator support some kind of "multisig"
     * @return sigForAggregation the value to pass (for all wallets) to aggregateSignatures()
     */
    function validateUserOpSignature(UserOperation calldata userOp) external view returns (bytes memory sigForUserOp, bytes memory sigForAggregation) {
        uint256[2] memory signature = abi.decode(userOp.signature, (uint256[2]));
        uint256[4] memory pubkey = IBLSWallet(userOp.getSender()).getBLSPublicKey();
        uint256[2] memory message = userOpToMessage(userOp);

        require(BLSOepen.verifySingle(signature, pubkey, message), "wrong sig");
        return ("", userOp.signature);
    }

    /**
     * aggregate multiple signatures into a single value.
     * This method is called off-chain to calculate the signature to pass with handleOps()
     * bundler MAY use optimized custom code perform this aggregation
     * @param sigsForAggregation array of values returned by validateUserOpSignature() for each op
     * @return aggregatesSignature the aggregated signature
     */
    function aggregateSignatures(bytes[] calldata sigsForAggregation) external view returns (bytes memory aggregatesSignature) {
        //TODO: aggregate all signatures
    }

}
