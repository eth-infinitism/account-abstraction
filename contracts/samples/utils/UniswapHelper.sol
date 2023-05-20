// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryPayments.sol";

abstract contract UniswapHelper {
    event UniswapReverted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin);

    struct UniswapHelperConfig {
        ISwapRouter uniswap;

        /// @notice Minimum eth amount to get from a swap
        uint256 minSwapAmount;

        uint24 uniswapPoolFee;

        uint8 slippage;
    }

    ISwapRouter public immutable uniswap;
    IERC20 public immutable wrappedNative;

    UniswapHelperConfig private uniswapHelperConfig;

    constructor(
        IERC20 _wrappedNative,
        ISwapRouter _uniswap,
        UniswapHelperConfig memory _uniswapHelperConfig
    ){
        wrappedNative = _wrappedNative;
        uniswap = _uniswap;
        _setUniswapHelperConfiguration(_uniswapHelperConfig);
    }

    function _setUniswapHelperConfiguration(UniswapHelperConfig memory _uniswapHelperConfig) internal {
        uniswapHelperConfig = _uniswapHelperConfig;
    }

    function _maybeSwapTokenToWeth(IERC20 tokenIn, uint256 quote, bool reverseQuote) internal returns (uint256) {
        uint256 tokenBalance = tokenIn.balanceOf(address(this));
        //        uint256 quote = toActualQuote(uint256(tokenSwapData.priceFeed.latestAnswer()), tokenSwapData.priceDivisor);
        uint256 amountOutMin = addSlippage(tokenToWei(tokenBalance, quote, reverseQuote), uniswapHelperConfig.slippage);
        if (amountOutMin < uniswapHelperConfig.minSwapAmount) {
            return 0;
        }
        return swapToToken(
            address(tokenIn),
            address(wrappedNative),
            tokenBalance,
            amountOutMin,
            uniswapHelperConfig.uniswapPoolFee,
            uniswap
        );
    }

    function addSlippage(uint256 amount, uint8 slippage) private pure returns (uint256) {
        return amount * (1000 - slippage) / 1000;
    }


    function tokenToWei(uint256 amount, uint256 quote, bool reverse) private pure returns (uint256) {
        if (reverse) {
            return weiToToken(amount, quote, false);
        }
        return amount * quote / 1e36;
    }

    function weiToToken(uint256 amount, uint256 quote, bool reverse) private pure returns (uint256) {
        if (reverse) {
            return tokenToWei(amount, quote, false);
        }
        return amount * 1e36 / quote;
    }

    // turn ERC-20 tokens into wrapped ETH at market price
    function swapToWeth(
        address token,
        address weth,
        uint256 amountOut,
        uint24 fee,
        ISwapRouter uniswap
    ) internal returns (uint256 amountIn) {
        ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter.ExactOutputSingleParams(
            token, //tokenIn
            weth, //tokenOut
            fee,
            address(uniswap), //recipient - keep WETH at SwapRouter for withdrawal
            // solhint-disable-next-line not-rely-on-time
            block.timestamp, //deadline
            amountOut,
            type(uint256).max,
            0
        );
        amountIn = uniswap.exactOutputSingle(params);
    }

    function unwrapWeth(ISwapRouter uniswap, uint256 amount) internal {
        IPeripheryPayments(address(uniswap)).unwrapWETH9(amount, address(this));
    }

    // swap ERC-20 tokens at market price
    function swapToToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 fee,
        ISwapRouter uniswap
    ) internal returns (uint256 amountOut) {
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams(
            tokenIn, //tokenIn
            tokenOut, //tokenOut
            fee,
            address(uniswap),
            // solhint-disable-next-line not-rely-on-time
            block.timestamp, //deadline
            amountIn,
            amountOutMin,
            0
        );
        try uniswap.exactInputSingle(params) returns (uint256 _amountOut) {
            amountOut = _amountOut;
        } catch {
            emit UniswapReverted(tokenIn, tokenOut, amountIn, amountOutMin);
            amountOut = 0;
        }
    }
}
