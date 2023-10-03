//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;
pragma abicoder v2;

import "../../interfaces/IAggregator.sol";
import "../../interfaces/IEntryPoint.sol";
import "../../core/UserOperationLib.sol";
import {BLSOpen} from  "./lib/BLSOpen.sol";
import "./IBLSAccount.sol";
import "./BLSHelper.sol";

/**
 * A BLS-based signature aggregator, to validate aggregated signature of multiple UserOps if BLSAccount
 */
contract BLSSignatureAggregator is IAggregator {
    using UserOperationLib for UserOperation;

    bytes32 public constant BLS_DOMAIN = keccak256("eip4337.bls.domain");

     //copied from BLS.sol
    uint256 public  constant N = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    /**
     * @return publicKey - the public key from a BLS keypair the Aggregator will use to verify this UserOp;
     *         normally public key will be queried from the deployed BLSAccount itself;
     *         the public key will be read from the 'initCode' if the account is not deployed yet;
     */
    function getUserOpPublicKey(UserOperation memory userOp) public view returns (uint256[4] memory publicKey) {
        bytes memory initCode = userOp.initCode;
        if (initCode.length > 0) {
            publicKey = getTrailingPublicKey(initCode);
        } else {
            return IBLSAccount(userOp.sender).getBlsPublicKey{gas : 50000}();
        }
    }

    /**
     * return the trailing 4 words of input data
     */
    function getTrailingPublicKey(bytes memory data) public pure returns (uint256[4] memory publicKey) {
        uint len = data.length;
        require(len > 32 * 4, "data too short for sig");

        /* solhint-disable-next-line no-inline-assembly */
        assembly {
        // actual buffer starts at data+32, so last 128 bytes start at data+32+len-128 = data+len-96
            let ofs := sub(add(data, len), 96)
            mstore(publicKey, mload(ofs))
            mstore(add(publicKey, 32), mload(add(ofs, 32)))
            mstore(add(publicKey, 64), mload(add(ofs, 64)))
            mstore(add(publicKey, 96), mload(add(ofs, 96)))
        }
    }

    /// @inheritdoc IAggregator
    function validateSignatures(UserOperation[] calldata userOps, bytes calldata signature)
    external view override {
        require(signature.length == 64, "BLS: invalid signature");
        (uint256[2] memory blsSignature) = abi.decode(signature, (uint256[2]));

        uint userOpsLen = userOps.length;
        uint256[4][] memory blsPublicKeys = new uint256[4][](userOpsLen);
        uint256[2][] memory messages = new uint256[2][](userOpsLen);
        for (uint256 i = 0; i < userOpsLen; i++) {

            UserOperation memory userOp = userOps[i];
            blsPublicKeys[i] = getUserOpPublicKey(userOp);

            messages[i] = _userOpToMessage(userOp, _getPublicKeyHash(blsPublicKeys[i]));
        }
        require(BLSOpen.verifyMultiple(blsSignature, blsPublicKeys, messages), "BLS: validateSignatures failed");
    }

    /**
     * get a hash of userOp
     * NOTE: this hash is not the same as UserOperation.hash()
     *  (slightly less efficient, since it uses memory userOp)
     */
    function internalUserOpHash(UserOperation memory userOp) internal pure returns (bytes32) {
        return keccak256(abi.encode(
                userOp.sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.callGasLimit,
                userOp.verificationGasLimit,
                userOp.preVerificationGas,
                userOp.maxFeePerGas,
                userOp.maxPriorityFeePerGas,
                keccak256(userOp.paymasterAndData)
            ));
    }

    /**
     * return the BLS "message" for the given UserOp.
     * the account checks the signature over this value using its public key
     */
    function userOpToMessage(UserOperation memory userOp) public view returns (uint256[2] memory) {
        bytes32 publicKeyHash = _getPublicKeyHash(getUserOpPublicKey(userOp));
        return _userOpToMessage(userOp, publicKeyHash);
    }

    function _userOpToMessage(UserOperation memory userOp, bytes32 publicKeyHash) internal view returns (uint256[2] memory) {
        bytes32 userOpHash = _getUserOpHash(userOp, publicKeyHash);
        return BLSOpen.hashToPoint(BLS_DOMAIN, abi.encodePacked(userOpHash));
    }

    // helper for test
    function getUserOpHash(UserOperation memory userOp) public view returns (bytes32) {
        bytes32 publicKeyHash = _getPublicKeyHash(getUserOpPublicKey(userOp));
        return _getUserOpHash(userOp, publicKeyHash);
    }

    function _getUserOpHash(UserOperation memory userOp, bytes32 publicKeyHash) internal view returns (bytes32) {
        return keccak256(abi.encode(internalUserOpHash(userOp), publicKeyHash, address(this), block.chainid));
    }

    function _getPublicKeyHash(uint256[4] memory publicKey) internal pure returns(bytes32) {
        return keccak256(abi.encode(publicKey));
    }
    /**
     * validate signature of a single userOp
     * This method is called after EntryPoint.simulateValidation() returns an aggregator.
     * First it validates the signature over the userOp. then it return data to be used when creating the handleOps:
     * @param userOp the userOperation received from the user.
     * @return sigForUserOp the value to put into the signature field of the userOp when calling handleOps.
     *    (usually empty, unless account and aggregator support some kind of "multisig"
     */
    function validateUserOpSignature(UserOperation calldata userOp)
    external view returns (bytes memory sigForUserOp) {
        uint256[2] memory signature = abi.decode(userOp.signature, (uint256[2]));
        uint256[4] memory pubkey = getUserOpPublicKey(userOp);
        uint256[2] memory message = _userOpToMessage(userOp, _getPublicKeyHash(pubkey));

        require(BLSOpen.verifySingle(signature, pubkey, message), "BLS: wrong sig");
        return "";
    }


    /**
     * aggregate multiple signatures into a single value.
     * This method is called off-chain to calculate the signature to pass with handleOps()
     * bundler MAY use optimized custom code perform this aggregation
     * @param userOps array of UserOperations to collect the signatures from.
     * @return aggregatedSignature the aggregated signature
     */
    function aggregateSignatures(UserOperation[] calldata userOps) external pure returns (bytes memory aggregatedSignature) {
        BLSHelper.XY[] memory points = new BLSHelper.XY[](userOps.length);
        for (uint i = 0; i < points.length; i++) {
            (uint256 x, uint256 y) = abi.decode(userOps[i].signature, (uint256, uint256));
            points[i] = BLSHelper.XY(x, y);
        }
        BLSHelper.XY memory sum = BLSHelper.sum(points, N);
        return abi.encode(sum.x, sum.y);
    }

    /**
     * allow staking for this aggregator
     * there is no limit on stake or delay, but it is not a problem, since it is a permissionless
     * signature aggregator, which doesn't support unstaking.
     */
    function addStake(IEntryPoint entryPoint, uint32 delay) external payable {
        entryPoint.addStake{value : msg.value}(delay);
    }
}
