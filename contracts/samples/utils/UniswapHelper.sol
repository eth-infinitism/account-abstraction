// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

abstract contract UniswapHelper {
    struct UniswapConfig {
        ISwapRouter uniswap;
        // Minimum eth amount to get from a swap
        uint256 minSwapAmount;
        uint24 uniswapPoolFees;
        uint8 slippages;
    }
}
