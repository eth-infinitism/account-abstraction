// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./UserOperation.sol";
import "./IWallet.sol";
import "./IAggregator.sol";

/**
 * Aggregated wallet, that support IAggregator.
 * - the validateUserOp will be called only after the aggregator validated this wallet (with all other wallets of this aggregator).
 * - the validateUserOp should validate that the signature field
 */
interface IAggregatedWallet is IWallet {

    /**
     * return the address of the signature aggregator the wallet supports.
     */
    function getAggregator() external view returns (IAggregator);
}
