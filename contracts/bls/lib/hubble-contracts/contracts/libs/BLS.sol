// SPDX-License-Identifier: MIT
pragma solidity >= 0.6.12;

import { ModexpInverse, ModexpSqrt } from "./ModExp.sol";
import {
    BNPairingPrecompileCostEstimator
} from "./BNPairingPrecompileCostEstimator.sol";

/**
    @title  Boneh–Lynn–Shacham (BLS) signature scheme on Barreto-Naehrig 254 bit curve (BN-254)
    @notice We use BLS signature aggregation to reduce the size of signature data to store on chain.
    @dev We use G1 points for signatures and messages, and G2 points for public keys
 */
library BLS {
    // Field order
    // prettier-ignore
    uint256 private constant N = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Negated genarator of G2
    // prettier-ignore
    uint256 private constant N_G2_X1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    // prettier-ignore
    uint256 private constant N_G2_X0 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    // prettier-ignore
    uint256 private constant N_G2_Y1 = 17805874995975841540914202342111839520379459829704422454583296818431106115052;
    // prettier-ignore
    uint256 private constant N_G2_Y0 = 13392588948715843804641432497768002650278120570034223513918757245338268106653;

    // sqrt(-3)
    // prettier-ignore
    uint256 private constant Z0 = 0x0000000000000000b3c4d79d41a91759a9e4c7e359b6b89eaec68e62effffffd;
    // (sqrt(-3) - 1)  / 2
    // prettier-ignore
    uint256 private constant Z1 = 0x000000000000000059e26bcea0d48bacd4f263f1acdb5c4f5763473177fffffe;

    // prettier-ignore
    uint256 private constant T24 = 0x1000000000000000000000000000000000000000000000000;
    // prettier-ignore
    uint256 private constant MASK24 = 0xffffffffffffffffffffffffffffffffffffffffffffffff;

    // estimator address
//    address private constant COST_ESTIMATOR_ADDRESS =  new 0x22E4a5251C1F02de8369Dd6f192033F6CB7531A4;

    function verifySingle(
        uint256[2] memory signature,
        uint256[4] memory pubkey,
        uint256[2] memory message
    ) internal view returns (bool, bool) {
        uint256[12] memory input =
            [
                signature[0],
                signature[1],
                N_G2_X1,
                N_G2_X0,
                N_G2_Y1,
                N_G2_Y0,
                message[0],
                message[1],
                pubkey[1],
                pubkey[0],
                pubkey[3],
                pubkey[2]
            ];
        uint256[1] memory out;
        uint256 precompileGasCost = gasleft();
//            BNPairingPrecompileCostEstimator(COST_ESTIMATOR_ADDRESS).getGasCost(
//                2
//            );
        bool callSuccess;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            callSuccess := staticcall(
                precompileGasCost,
                8,
                input,
                384,
                out,
                0x20
            )
        }
        if (!callSuccess) {
            return (false, false);
        }
        return (out[0] != 0, true);
    }

    function verifyMultiple(
        uint256[2] memory signature,
        uint256[4][] memory pubkeys,
        uint256[2][] memory messages
    ) internal view returns (bool checkResult, bool callSuccess) {
        uint256 size = pubkeys.length;
        require(size > 0, "BLS: number of public key is zero");
        require(
            size == messages.length,
            "BLS: number of public keys and messages must be equal"
        );
        uint256 inputSize = (size + 1) * 6;
        uint256[] memory input = new uint256[](inputSize);
        input[0] = signature[0];
        input[1] = signature[1];
        input[2] = N_G2_X1;
        input[3] = N_G2_X0;
        input[4] = N_G2_Y1;
        input[5] = N_G2_Y0;
        for (uint256 i = 0; i < size; i++) {
            input[i * 6 + 6] = messages[i][0];
            input[i * 6 + 7] = messages[i][1];
            input[i * 6 + 8] = pubkeys[i][1];
            input[i * 6 + 9] = pubkeys[i][0];
            input[i * 6 + 10] = pubkeys[i][3];
            input[i * 6 + 11] = pubkeys[i][2];
        }
        uint256[1] memory out;

        // prettier-ignore
        uint256 precompileGasCost = gasleft();
//        uint256 precompileGasCost = BNPairingPrecompileCostEstimator(COST_ESTIMATOR_ADDRESS).getGasCost(size + 1);
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            callSuccess := staticcall(
                precompileGasCost,
                8,
                add(input, 0x20),
                mul(inputSize, 0x20),
                out,
                0x20
            )
        }
        if (!callSuccess) {
            return (false, false);
        }
        return (out[0] != 0, true);
    }

    /**
    @notice Fouque-Tibouchi Hash to Curve
     */
    function hashToPoint(bytes32 domain, bytes memory message)
        internal
        view
        returns (uint256[2] memory)
    {
        uint256[2] memory u = hashToField(domain, message);
        uint256[2] memory p0 = mapToPoint(u[0]);
        uint256[2] memory p1 = mapToPoint(u[1]);
        uint256[4] memory bnAddInput;
        bnAddInput[0] = p0[0];
        bnAddInput[1] = p0[1];
        bnAddInput[2] = p1[0];
        bnAddInput[3] = p1[1];
        bool success;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            success := staticcall(sub(gas(), 2000), 6, bnAddInput, 128, p0, 64)
            switch success
                case 0 {
                    invalid()
                }
        }
        require(success, "BLS: bn add call failed");
        return p0;
    }

    function mapToPoint(uint256 _x)
        internal
        pure
        returns (uint256[2] memory p)
    {
        require(_x < N, "mapToPointFT: invalid field element");
        uint256 x = _x;

        (, bool decision) = sqrt(x);

        uint256 a0 = mulmod(x, x, N);
        a0 = addmod(a0, 4, N);
        uint256 a1 = mulmod(x, Z0, N);
        uint256 a2 = mulmod(a1, a0, N);
        a2 = inverse(a2);
        a1 = mulmod(a1, a1, N);
        a1 = mulmod(a1, a2, N);

        // x1
        a1 = mulmod(x, a1, N);
        x = addmod(Z1, N - a1, N);
        // check curve
        a1 = mulmod(x, x, N);
        a1 = mulmod(a1, x, N);
        a1 = addmod(a1, 3, N);
        bool found;
        (a1, found) = sqrt(a1);
        if (found) {
            if (!decision) {
                a1 = N - a1;
            }
            return [x, a1];
        }

        // x2
        x = N - addmod(x, 1, N);
        // check curve
        a1 = mulmod(x, x, N);
        a1 = mulmod(a1, x, N);
        a1 = addmod(a1, 3, N);
        (a1, found) = sqrt(a1);
        if (found) {
            if (!decision) {
                a1 = N - a1;
            }
            return [x, a1];
        }

        // x3
        x = mulmod(a0, a0, N);
        x = mulmod(x, x, N);
        x = mulmod(x, a2, N);
        x = mulmod(x, a2, N);
        x = addmod(x, 1, N);
        // must be on curve
        a1 = mulmod(x, x, N);
        a1 = mulmod(a1, x, N);
        a1 = addmod(a1, 3, N);
        (a1, found) = sqrt(a1);
        require(found, "BLS: bad ft mapping implementation");
        if (!decision) {
            a1 = N - a1;
        }
        return [x, a1];
    }

    function isValidSignature(uint256[2] memory signature)
        internal
        pure
        returns (bool)
    {
        if ((signature[0] >= N) || (signature[1] >= N)) {
            return false;
        } else {
            return isOnCurveG1(signature);
        }
    }

    function isOnCurveG1(uint256[2] memory point)
        internal
        pure
        returns (bool _isOnCurve)
    {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            let t0 := mload(point)
            let t1 := mload(add(point, 32))
            let t2 := mulmod(t0, t0, N)
            t2 := mulmod(t2, t0, N)
            t2 := addmod(t2, 3, N)
            t1 := mulmod(t1, t1, N)
            _isOnCurve := eq(t1, t2)
        }
    }

    function isOnCurveG2(uint256[4] memory point)
        internal
        pure
        returns (bool _isOnCurve)
    {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            // x0, x1
            let t0 := mload(point)
            let t1 := mload(add(point, 32))
            // x0 ^ 2
            let t2 := mulmod(t0, t0, N)
            // x1 ^ 2
            let t3 := mulmod(t1, t1, N)
            // 3 * x0 ^ 2
            let t4 := add(add(t2, t2), t2)
            // 3 * x1 ^ 2
            let t5 := addmod(add(t3, t3), t3, N)
            // x0 * (x0 ^ 2 - 3 * x1 ^ 2)
            t2 := mulmod(add(t2, sub(N, t5)), t0, N)
            // x1 * (3 * x0 ^ 2 - x1 ^ 2)
            t3 := mulmod(add(t4, sub(N, t3)), t1, N)

            // x ^ 3 + b
            t0 := addmod(
                t2,
                0x2b149d40ceb8aaae81be18991be06ac3b5b4c5e559dbefa33267e6dc24a138e5,
                N
            )
            t1 := addmod(
                t3,
                0x009713b03af0fed4cd2cafadeed8fdf4a74fa084e52d1852e4a2bd0685c315d2,
                N
            )

            // y0, y1
            t2 := mload(add(point, 64))
            t3 := mload(add(point, 96))
            // y ^ 2
            t4 := mulmod(addmod(t2, t3, N), addmod(t2, sub(N, t3), N), N)
            t3 := mulmod(shl(1, t2), t3, N)

            // y ^ 2 == x ^ 3 + b
            _isOnCurve := and(eq(t0, t4), eq(t1, t3))
        }
    }

    function sqrt(uint256 xx) internal pure returns (uint256 x, bool hasRoot) {
        x = ModexpSqrt.run(xx);
        hasRoot = mulmod(x, x, N) == xx;
    }

    function inverse(uint256 a) internal pure returns (uint256) {
        return ModexpInverse.run(a);
    }

    function hashToField(bytes32 domain, bytes memory messages)
        internal
        pure
        returns (uint256[2] memory)
    {
        bytes memory _msg = expandMsgTo96(domain, messages);
        uint256 u0;
        uint256 u1;
        uint256 a0;
        uint256 a1;
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            let p := add(_msg, 24)
            u1 := and(mload(p), MASK24)
            p := add(_msg, 48)
            u0 := and(mload(p), MASK24)
            a0 := addmod(mulmod(u1, T24, N), u0, N)
            p := add(_msg, 72)
            u1 := and(mload(p), MASK24)
            p := add(_msg, 96)
            u0 := and(mload(p), MASK24)
            a1 := addmod(mulmod(u1, T24, N), u0, N)
        }
        return [a0, a1];
    }

    function expandMsgTo96(bytes32 domain, bytes memory message)
        internal
        pure
        returns (bytes memory)
    {
        // zero<64>|msg<var>|lib_str<2>|I2OSP(0, 1)<1>|dst<var>|dst_len<1>
        uint256 t0 = message.length;
        bytes memory msg0 = new bytes(32 + t0 + 64 + 4);
        bytes memory out = new bytes(96);
        // b0
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            let p := add(msg0, 96)
            for {
                let z := 0
            } lt(z, t0) {
                z := add(z, 32)
            } {
                mstore(add(p, z), mload(add(message, add(z, 32))))
            }
            p := add(p, t0)

            mstore8(p, 0)
            p := add(p, 1)
            mstore8(p, 96)
            p := add(p, 1)
            mstore8(p, 0)
            p := add(p, 1)

            mstore(p, domain)
            p := add(p, 32)
            mstore8(p, 32)
        }
        bytes32 b0 = sha256(msg0);
        bytes32 bi;
        t0 = 32 + 34;

        // resize intermediate message
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            mstore(msg0, t0)
        }

        // b1

        // solium-disable-next-line security/no-inline-assembly
        assembly {
            mstore(add(msg0, 32), b0)
            mstore8(add(msg0, 64), 1)
            mstore(add(msg0, 65), domain)
            mstore8(add(msg0, add(32, 65)), 32)
        }

        bi = sha256(msg0);

        // solium-disable-next-line security/no-inline-assembly
        assembly {
            mstore(add(out, 32), bi)
        }

        // b2

        // solium-disable-next-line security/no-inline-assembly
        assembly {
            let t := xor(b0, bi)
            mstore(add(msg0, 32), t)
            mstore8(add(msg0, 64), 2)
            mstore(add(msg0, 65), domain)
            mstore8(add(msg0, add(32, 65)), 32)
        }

        bi = sha256(msg0);

        // solium-disable-next-line security/no-inline-assembly
        assembly {
            mstore(add(out, 64), bi)
        }

        // b3

        // solium-disable-next-line security/no-inline-assembly
        assembly {
            let t := xor(b0, bi)
            mstore(add(msg0, 32), t)
            mstore8(add(msg0, 64), 3)
            mstore(add(msg0, 65), domain)
            mstore8(add(msg0, add(32, 65)), 32)
        }

        bi = sha256(msg0);

        // solium-disable-next-line security/no-inline-assembly
        assembly {
            mstore(add(out, 96), bi)
        }

        return out;
    }
}
