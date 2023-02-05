// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.6;

import "../interfaces/IAggregatedAccount.sol";

/**
 * a BLS account should expose its own public key.
 */
interface IBLSAccount is IAggregatedAccount {
    event PublicKeyChanged(uint256[4] oldPublicKey, uint256[4] newPublicKey);

    function getBlsPublicKey() external view returns (uint256[4] memory);
}
