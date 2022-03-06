// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "../IWallet.sol";
import "../EntryPoint.sol";
import "./ECDSA.sol";

//minimal wallet
// this is sample minimal wallet.
// has execute, eth handling methods
// has a single signer that can send requests through the entryPoint.
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
     * subclass should return a nonce value that is used both by validateNonce, and by the exernal provider (to read the current nonce)
     */
    function nonce() public view virtual returns (uint256);

    function entryPoint() public view virtual returns (EntryPoint);

    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, uint256 requiredPrefund) external override {
        _requireFromEntryPoint();
        _validateSignature(userOp, requestId);
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            _validateAndIncrementNonce(userOp);
        }
        _payPrefund(requiredPrefund);
    }

    function _requireFromEntryPoint() internal virtual view {
        require(msg.sender == address(entryPoint()), "wallet: not from EntryPoint");
    }

    /// helper function: recover the signer of this UserOp.
    /// NOTE: specifically,
    /// expected to by used by validateSignature
    function _recoverSigner(UserOperation calldata userOp, bytes32 requestId) internal virtual view returns (address) {
        bytes32 hash = requestId.toEthSignedMessageHash();
        return hash.recover(userOp.signature);
    }

    /// validate the signature is valid for this message.
    /// must NOT use the "GAS" opcode while calling the "ecrecover" precompile, which is banned during validateUserOp
    function _validateSignature(UserOperation calldata userOp, bytes32 requestId) internal virtual view;

    /// validate the current nonce matches the UserOperation nonce.
    /// also, increment the nonce, to prevent replay of this UserOperation.
    /// called only if initCode is empty (since "nonce" field is used as "salt" on wallet creation)
    function _validateAndIncrementNonce(UserOperation calldata userOp) internal virtual;

    function _payPrefund(uint256 requiredPrefund) internal virtual {
        if (requiredPrefund != 0) {
            //pay required prefund. make sure NOT to use the "gas" opcode, which is banned during validateUserOp
            // (and used by default by the "call")
            (bool success,) = payable(msg.sender).call{value : requiredPrefund, gas : type(uint256).max}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }
}
