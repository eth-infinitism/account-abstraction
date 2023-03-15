// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../interfaces/IEntryPoint.sol";
import "hardhat/console.sol";

/**
 * nonce management functionality
 */
contract NonceManager is INonceManager {

    mapping(address => mapping(uint192 => uint256)) public nonces;

    function getNonce(address sender, uint192 key)
    external view override returns (uint256 nonce) {
//        console.log('getNonce sender %s key %s seq %s', sender, uint(key), uint(nonces[sender][key + 1]));
        return nonces[sender][key + 1] | (uint256(key) << 64);
    }

    /**
     * validate nonce uniqueness for this account.
     * called just after validateUserOp()
     */
    function _validateAndUpdateNonce(address sender, uint256 nonce) internal returns (bool) {

        uint192 key = uint192(nonce >> 64);
        uint64 seq = uint64(nonce);

        //        console.log('validateNAndUpdate sender %s nonce %s seq %s', sender, uint(nonce), uint(nonces[sender][key+1]));
        return nonces[sender][key + 1]++ == seq;
    }

}
