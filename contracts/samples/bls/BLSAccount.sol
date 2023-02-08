// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../SimpleAccount.sol";
import "./IBLSAccount.sol";

/**
 * Minimal BLS-based account that uses an aggregated signature.
 * The account must maintain its own BLS public-key, and expose its trusted signature aggregator.
 * Note that unlike the "standard" SimpleAccount, this account can't be called directly
 * (normal SimpleAccount uses its "signer" address as both the ecrecover signer, and as a legitimate
 * Ethereum sender address. Obviously, a BLS public is not a valid Ethereum sender address.)
 */
contract BLSAccount is SimpleAccount, IBLSAccount {
    address public immutable aggregator;
    uint256[4] private publicKey;

    // The constructor is used only for the "implementation" and only sets immutable values.
    // Mutable values slots for proxy accounts are set by the 'initialize' function.
    constructor(IEntryPoint anEntryPoint, address anAggregator) SimpleAccount(anEntryPoint)  {
        aggregator = anAggregator;
    }

    /**
     * The initializer for the BLSAccount instance.
     * @param aPublicKey public key from a BLS keypair that will have a full ownership and control of this account.
     */
    function initialize(uint256[4] memory aPublicKey) public virtual initializer {
        super._initialize(address(0));
        publicKey = aPublicKey;
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address userOpAggregator)
    internal override view returns (uint256 sigTimeRange) {

        (userOp, userOpHash);
        if (userOp.initCode.length != 0) {
            // BLSSignatureAggregator.getUserOpPublicKey() assumes that during account creation, the public key is
            // the suffix of the initCode.
            // The account MUST validate it
            bytes32 pubKeyHash = keccak256(abi.encode(getBlsPublicKey()));
            require(keccak256(userOp.initCode[userOp.initCode.length - 128 :]) == pubKeyHash, "wrong pubkey");
        }
        require(userOpAggregator == aggregator, "BLSAccount: wrong aggregator");
        return 0;
    }

    event PublicKeyChanged(uint256[4] oldPublicKey, uint256[4] newPublicKey);

    /**
     * Allows the owner to set or change the BSL key.
     * @param newPublicKey public key from a BLS keypair that will have a full ownership and control of this account.
     */
    function setBlsPublicKey(uint256[4] memory newPublicKey) external onlyOwner {
        emit PublicKeyChanged(publicKey, newPublicKey);
        publicKey = newPublicKey;
    }

    /**
     * @return address of an aggregator contract trusted by this account to verify BSL signatures aggregated in a batch.
     */
    function getAggregator() external view returns (address) {
        return aggregator;
    }

    /// @inheritdoc IBLSAccount
    function getBlsPublicKey() public override view returns (uint256[4] memory) {
        return publicKey;
    }
}
