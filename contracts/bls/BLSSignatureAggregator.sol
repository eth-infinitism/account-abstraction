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

    function validateSignatures(address entryPoint, UserOperation[] calldata userOps, bytes calldata signature)
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
            messages[i] = userOpToMessage(userOp, entryPoint);
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
    function userOpToMessage(UserOperation memory userOp, address entryPoint) public view returns (uint256[2] memory) {
        // requestId same as entryPoint.getRequestId()
        bytes32 requestId = keccak256(abi.encode(getUserOpHash(userOp), entryPoint, block.chainid));
        return BLSOpen.hashToPoint(BLS_DOMAIN, abi.encodePacked(requestId));
    }
}