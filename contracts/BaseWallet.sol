// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./IWallet.sol";
import "./EntryPoint.sol";
import "./samples/ECDSA.sol";

/**
 * Basic wallet implmenetation.
 * this contract provides the basic logic for implementing the IWallet interface  - validateUserOp
 * specific wallet implementation should inherit it and provide the wallet-specific logic
 */
abstract contract BaseWallet is IWallet {
    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;

    /**
     * return the wallet nonce.
     * subclass should return a nonce value that is used both by _validateAndUpdateNonce, and by the external provider (to read the current nonce)
     */
    function nonce() public view virtual returns (uint256);

    /**
     * return the entryPoint used by this wallet.
     * subclass should return the current entryPoint used by this wallet.
     * The implementation must not assume that the entrypoint is static, and thus must allow the owner/admin to modify it.
     */
    function entryPoint() public view virtual returns (EntryPoint);

    /**
     * Validate user's signature and nonce.
     * subclass doesn't override this method. instead, it should override the specific internal validation methods.
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, uint256 missingWalletFunds) external override {
        _requireFromEntryPoint();
        _validateSignature(userOp, requestId);
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            _validateAndUpdateNonce(userOp);
        }
        _payPrefund(missingWalletFunds);
    }

    /// validate the request comes from the known entrypoint.
    function _requireFromEntryPoint() internal virtual view {
        require(msg.sender == address(entryPoint()), "wallet: not from EntryPoint");
    }

    /**
     * helper function: recover the signer of this UserOp.
     * must be used instead of "ecrecover", since the GAS opcode is not allowed to be used by validateUserOp
     * expected to by used by _validateSignature
     */
    function _recoverSigner(UserOperation calldata userOp, bytes32 requestId) internal virtual view returns (address) {
        bytes32 hash = requestId.toEthSignedMessageHash();
        return hash.recover(userOp.signature);
    }

    /**
     * validate the signature is valid for this message.
     * must NOT use the "GAS" opcode while calling the "ecrecover" precompile, which is banned during validateUserOp
     * should use "_recoverSigner" utility method.
     */
    function _validateSignature(UserOperation calldata userOp, bytes32 requestId) internal virtual view;

    /**
     * validate the current nonce matches the UserOperation nonce.
     * then it should update the wallet's state to prevent replay of this UserOperation.
     * called only if initCode is empty (since "nonce" field is used as "salt" on wallet creation)
     */
    function _validateAndUpdateNonce(UserOperation calldata userOp) internal virtual;

    /**
     * sends to the entrypoint (msg.sender) the missing funds for this transaction.
     * subclass MAY override this method for better funds management
     * (e.g. send to the entryPoint more than the minimum required, so that in future transactions
     * it will not be required to send again)
     * note: in any case, should NOT use the "GAS" opcode.
     */
    function _payPrefund(uint256 missingWalletFunds) internal virtual {
        if (missingWalletFunds != 0) {
            //pay required prefund. make sure NOT to use the "gas" opcode, which is banned during validateUserOp
            // (and used by default by the "call")
            (bool success,) = payable(msg.sender).call{value : missingWalletFunds, gas : type(uint256).max}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }
}
