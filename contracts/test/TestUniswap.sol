// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract TestUniswap {

    function exactOutputSingle(ISwapRouter.ExactOutputSingleParams calldata) external returns (uint256) {
        return 0;
    }

    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata) external returns (uint256) {
        return 0;
    }

}
