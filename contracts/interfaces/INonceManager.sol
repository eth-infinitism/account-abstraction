// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

interface INonceManager {

    /**
     * return the next nonce for this sender
     * @param sender the account address
     * @param key the high 192 bit of the nonce
     * @return nonce a full nonce to pass for next UserOp with this sender.
     */
    function getNonce(address sender, uint192 key)
    external view returns (uint256 nonce);

    function incrementNonce(uint192 key) external;
}
