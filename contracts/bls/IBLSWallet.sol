// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;

import "../interfaces/IAggregatedWallet.sol";

/**
 * a BLS wallet should expose its own public key.
 */
interface IBLSWallet is IAggregatedWallet {
    function getBlsPublicKey() external view returns (uint256[4] memory);
}
