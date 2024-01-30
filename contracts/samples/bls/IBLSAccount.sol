// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.7.5;

import "../../interfaces/IAccount.sol";

/**
 * a BLS account should expose its own public key.
 */
interface IBLSAccount is IAccount {
    event PublicKeyChanged(uint256[4] oldPublicKey, uint256[4] newPublicKey);

    /**
     * @return public key from a BLS keypair that is used to verify the BLS signature, both separately and aggregated.
     */
    function getBlsPublicKey() external view returns (uint256[4] memory);
}
