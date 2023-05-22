// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "./TestWrappedNativeToken.sol";

// STOPSHIP: TODO: remove
import "hardhat/console.sol";

/// @notice Very basic simulation of what Uniswap does with the swaps for the unit tests on the TokenPaymaster
/// @dev Do not use to test any actual Uniswap interaction logic as this is way too simplistic
contract TestUniswap {
    TestWrappedNativeToken public weth;

    constructor(TestWrappedNativeToken _weth){
        weth = _weth;
    }

    event StubUniswapExchangeEvent(uint256 amountIn, uint256 amountOut, address tokenIn, address tokenOut);

    function exactOutputSingle(ISwapRouter.ExactOutputSingleParams calldata params) external returns (uint256) {
        uint256 amountIn = params.amountInMaximum - 5;
        emit StubUniswapExchangeEvent(
            amountIn,
            params.amountOut,
            params.tokenIn,
            params.tokenOut
        );
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(params.tokenOut).transfer(params.recipient, params.amountOut);
        return amountIn;
    }

    function exactInputSingle(ISwapRouter.ExactInputSingleParams calldata params) external returns (uint256) {
        uint256 amountOut = params.amountOutMinimum + 5;
        emit StubUniswapExchangeEvent(
            params.amountIn,
            amountOut,
            params.tokenIn,
            params.tokenOut
        );
        console.log("inside exactInputSingle");
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        console.log("exactInputSingle after tokenIn transfer");
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
        console.log("exactInputSingle after tokenOut transfer");
        return amountOut;
    }

    /// @notice Simplified code copied from here:
    /// https://github.com/Uniswap/v3-periphery/blob/main/contracts/base/PeripheryPayments.sol#L19
    function unwrapWETH9(uint256 amountMinimum, address recipient) public payable {
        uint256 balanceWETH9 = weth.balanceOf(address(this));
        console.log("inside unwrapWETH9, balance =%s amountMinimum=%s", balanceWETH9, amountMinimum);
        require(balanceWETH9 >= amountMinimum, "Insufficient WETH9");

        if (balanceWETH9 > 0) {
            weth.withdraw(balanceWETH9);
            console.log("unwrapWETH9, recipient=%s", recipient);
            payable(recipient).transfer(balanceWETH9);
        }
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}
}
