// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12;

contract BNPairingPrecompileCostEstimator {
    uint256 public baseCost;
    uint256 public perPairCost;

    // G1 Generator
    uint256 private constant G1_X = 1;
    uint256 private constant G1_Y = 2;

    // G2 genarator
    // prettier-ignore
    uint256 private constant G2_X0 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    // prettier-ignore
    uint256 private constant G2_X1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    // prettier-ignore
    uint256 private constant G2_Y0 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    // prettier-ignore
    uint256 private constant G2_Y1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;

    // G2 negated genarator y coordinates
    // prettier-ignore
    uint256 private constant N_G2_Y0 = 13392588948715843804641432497768002650278120570034223513918757245338268106653;
    // prettier-ignore
    uint256 private constant N_G2_Y1 = 17805874995975841540914202342111839520379459829704422454583296818431106115052;

    function run() external {
        _run();
    }

    function getGasCost(uint256 pairCount) external view returns (uint256) {
        return pairCount * perPairCost + baseCost;
    }

    function _run() internal {
        uint256 gasCost1Pair = _gasCost1Pair();
        uint256 gasCost2Pair = _gasCost2Pair();
        perPairCost = gasCost2Pair - gasCost1Pair;
        baseCost = gasCost1Pair - perPairCost;
    }

    function _gasCost1Pair() internal view returns (uint256) {
        uint256[6] memory input = [G1_X, G1_Y, G2_X1, G2_X0, G2_Y1, G2_Y0];
        uint256[1] memory out;
        bool callSuccess;
        uint256 suppliedGas = gasleft() - 2000;
        require(
            gasleft() > 2000,
            "BNPairingPrecompileCostEstimator: not enough gas, single pair"
        );
        uint256 gasT0 = gasleft();
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            callSuccess := staticcall(suppliedGas, 8, input, 192, out, 0x20)
        }
        uint256 gasCost = gasT0 - gasleft();
        require(
            callSuccess,
            "BNPairingPrecompileCostEstimator: single pair call is failed"
        );
        require(
            out[0] == 0,
            "BNPairingPrecompileCostEstimator: single pair call result must be 0"
        );
        return gasCost;
    }

    function _gasCost2Pair() internal view returns (uint256) {
        uint256[12] memory input =
            [
                G1_X,
                G1_Y,
                G2_X1,
                G2_X0,
                G2_Y1,
                G2_Y0,
                G1_X,
                G1_Y,
                G2_X1,
                G2_X0,
                N_G2_Y1,
                N_G2_Y0
            ];
        uint256[1] memory out;
        bool callSuccess;
        uint256 suppliedGas = gasleft() - 2000;
        require(
            gasleft() > 2000,
            "BNPairingPrecompileCostEstimator: not enough gas, couple pair"
        );
        uint256 gasT0 = gasleft();
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            callSuccess := staticcall(suppliedGas, 8, input, 384, out, 0x20)
        }
        uint256 gasCost = gasT0 - gasleft();
        require(
            callSuccess,
            "BNPairingPrecompileCostEstimator: couple pair call is failed"
        );
        require(
            out[0] == 1,
            "BNPairingPrecompileCostEstimator: couple pair call result must be 1"
        );
        return gasCost;
    }
}
