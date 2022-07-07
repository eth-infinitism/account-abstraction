// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./UserOperation.sol";

/**
 * Aggregated Signatures validator.
 */
interface IAggregator {

  /**
   * validate aggregated signature.
   * revert if the aggregated signature does not match the given list of operations.
   */
  function validateSignatures(UserOperation[] calldata userOps, bytes calldata signature) view external;
}
