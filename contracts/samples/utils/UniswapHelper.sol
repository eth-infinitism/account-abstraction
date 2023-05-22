// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable not-rely-on-time */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryPayments.sol";

abstract contract UniswapHelper {
    event UniswapReverted(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin);

    uint256 private constant PRICE_DENOMINATOR = 1e6;

    struct UniswapHelperConfig {
        /// @notice Minimum native asset amount to receive from a single swap
        uint256 minSwapAmount;

        uint24 uniswapPoolFee;

        uint8 slippage;
    }

    /// @notice The Uniswap V3 SwapRouter contract
    ISwapRouter public immutable uniswap;

    /// @notice The ERC20 token used for transaction fee payments
    IERC20 public immutable token;

    /// @notice The ERC-20 token that wraps the native asset for current chain
    IERC20 public immutable wrappedNative;

    UniswapHelperConfig private uniswapHelperConfig;

    constructor(
        IERC20 _token,
        IERC20 _wrappedNative,
        ISwapRouter _uniswap,
        UniswapHelperConfig memory _uniswapHelperConfig
    ){
        _token.approve(address(_uniswap), type(uint256).max);
        token = _token;
        wrappedNative = _wrappedNative;
        uniswap = _uniswap;
        _setUniswapHelperConfiguration(_uniswapHelperConfig);
    }

    function _setUniswapHelperConfiguration(UniswapHelperConfig memory _uniswapHelperConfig) internal {
        uniswapHelperConfig = _uniswapHelperConfig;
    }

    function _maybeSwapTokenToWeth(IERC20 tokenIn, uint256 quote, bool reverseQuote) internal returns (uint256) {
        uint256 tokenBalance = tokenIn.balanceOf(address(this));
        uint256 amountOutMin = addSlippage(tokenToWei(tokenBalance, quote, reverseQuote), uniswapHelperConfig.slippage);
        if (amountOutMin < uniswapHelperConfig.minSwapAmount) {
            return 0;
        }
        // note: calling 'swapToToken' but destination token is Wrapped Ether
        return swapToToken(
            address(tokenIn),
            address(wrappedNative),
            tokenBalance,
            amountOutMin,
            uniswapHelperConfig.uniswapPoolFee
        );
    }

    function addSlippage(uint256 amount, uint8 slippage) private pure returns (uint256) {
        return amount * (1000 - slippage) / 1000;
    }


    function tokenToWei(uint256 amount, uint256 price, bool reverse) internal view returns (uint256) {
        if (reverse) {
            return weiToToken(amount, price, false);
        }
        return amount * price / PRICE_DENOMINATOR;
    }

    function weiToToken(uint256 amount, uint256 price, bool reverse) internal view returns (uint256) {
        if (reverse) {
            return tokenToWei(amount, price, false);
        }
        return amount * PRICE_DENOMINATOR / price;
    }

    // turn ERC-20 tokens into wrapped ETH at market price
    function swapToWeth(
        address tokenIn,
        address wethOut,
        uint256 amountOut,
        uint24 fee
    ) internal returns (uint256 amountIn) {
        ISwapRouter.ExactOutputSingleParams memory params = ISwapRouter.ExactOutputSingleParams(
            tokenIn,
            wethOut, //tokenOut
            fee,
            address(uniswap), //recipient - keep WETH at SwapRouter for withdrawal
            block.timestamp, //deadline
            amountOut,
            type(uint256).max,
            0
        );
        amountIn = uniswap.exactOutputSingle(params);
    }

    function unwrapWeth(uint256 amount) internal {
        IPeripheryPayments(address(uniswap)).unwrapWETH9(amount, address(this));
    }

    // swap ERC-20 tokens at market price
    function swapToToken(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint24 fee
    ) internal returns (uint256 amountOut) {
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams(
            tokenIn, //tokenIn
            tokenOut, //tokenOut
            fee,
            address(uniswap),
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
