// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./UserOperation.sol";
import "./IWallet.sol";
import "./IAggregator.sol";

/**
 * Aggregated wallet, that support IAggregator.
 * - the validateUserOp will be called only after the aggregator validated this wallet (with all other wallets of this aggregator).
 * - the validateUserOp should still validate signature field is empty
 *      (or, if the aggregator needs extra data per UserOp, that the signature contains that extra data)
 *  - in any case, the UserOp.signature field length should be below 64 bytes
 *  - e.g. with `require(userOp.signature.length<64)`
 */
interface IAggregatedWallet {

    /**
     * return the address of the signature aggregator the wallet supports.
     */
    function getAggregator() external view returns (address);

    /**
     * Validate user's signature and nonce
     * this version of validateUserOp is used for aggregated wallet.
     * while the signature field is still part of the UserOp, its usage is aggregator-specific, and most likely
     * be ignored.
     * the wallet MUST verify that the aggregator is indeed the one it supports
     *   e.g. with require(aggregator == getAggregator())
     * all other params have the same meaning as in IWallet.validateUserOp
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, address aggregator, uint256 missingWalletFunds) external;
}
