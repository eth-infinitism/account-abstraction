// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./IAccount.sol";

/**
 * Aggregated account that support IAggregator.
 * - the validateUserOp will be called only after the aggregator validated this account (with all other accounts of this aggregator).
 * - the validateUserOp MUST validate the aggregator parameter, and MAY ignore the userOp.signature field.
 */
interface IAggregatedAccount is IAccount {

    /**
     * return the address of the signature aggregator the account supports.
     */
    function getAggregator() external view returns (address);
}
