// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { BLS } from "./hubble-contracts/contracts/libs/BLS.sol";

library BLSOpen {
    function verifySingle(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        uint256[2] memory message
    ) external view returns (bool) {
        uint256[4][] memory pubkeys = new uint256[4][](1);
        uint256[2][] memory messages = new uint256[2][](1);
        pubkeys[0] = pubkey;
        messages[0] = message;

        (bool verified, bool callSuccess) =  BLS.verifyMultiple(
            signature,
            pubkeys,
            messages
        );
        return callSuccess && verified;

        // // NB: (result, success) opposite of `call` convention (success, result).
        // (bool verified, bool callSuccess) = BLS.verifySingle(
        //     signature,
        //     pubkey,
        //     message
        // );
        // return callSuccess && verified;
    }

    function verifyMultiple(
        uint256[2] memory signature,
        uint256[4][] memory pubkeys,
        uint256[2][] memory messages
    ) external view returns (bool) {
        (bool verified, bool callSuccess) =  BLS.verifyMultiple(
            signature,
            pubkeys,
            messages
        );
        return callSuccess && verified;
    }

    function hashToPoint(
        bytes32 domain,
        bytes memory message
    ) external view returns (uint256[2] memory) {
        return BLS.hashToPoint(
            domain,
            message
        );
    }

    function isZeroBLSKey(uint256[4] memory blsKey) public pure returns (bool) {
        bool isZero = true;
        for (uint256 i=0; isZero && i<4; i++) {
            isZero = (blsKey[i] == 0);
        }
        return isZero;
    }

}
