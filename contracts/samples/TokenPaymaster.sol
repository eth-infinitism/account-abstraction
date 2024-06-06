// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

// Import the required libraries and contracts
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import "../interfaces/IEntryPoint.sol";
import "../core/BasePaymaster.sol";
import "../core/Helpers.sol";
import "./utils/UniswapHelper.sol";
import "./utils/OracleHelper.sol";

/// @title Sample ERC-20 Token Paymaster for ERC-4337
/// This Paymaster covers gas fees in exchange for ERC20 tokens charged using allowance pre-issued by ERC-4337 accounts.
/// The contract refunds excess tokens if the actual gas cost is lower than the initially provided amount.
/// The token price cannot be queried in the validation code due to storage access restrictions of ERC-4337.
/// The price is cached inside the contract and is updated in the 'postOp' stage if the change is >10%.
/// It is theoretically possible the token has depreciated so much since the last 'postOp' the refund becomes negative.
/// The contract reverts the inner user transaction in that case but keeps the charge.
/// The contract also allows honest clients to prepay tokens at a higher price to avoid getting reverted.
/// It also allows updating price configuration and withdrawing tokens by the contract owner.
/// The contract uses an Oracle to fetch the latest token prices.
/// @dev Inherits from BasePaymaster.
contract TokenPaymaster is BasePaymaster, UniswapHelper, OracleHelper {

    using UserOperationLib for PackedUserOperation;

    struct TokenPaymasterConfig {
        /// @notice The price markup percentage applied to the token price (1e26 = 100%). Ranges from 1e26 to 2e26
        uint256 priceMarkup;

        /// @notice Exchange tokens to native currency if the EntryPoint balance of this Paymaster falls below this value
        uint128 minEntryPointBalance;

        /// @notice Estimated gas cost for refunding tokens after the transaction is completed
        uint48 refundPostopCost;

        /// @notice Transactions are only valid as long as the cached price is not older than this value
        uint48 priceMaxAge;
    }

    event ConfigUpdated(TokenPaymasterConfig tokenPaymasterConfig);

    event UserOperationSponsored(address indexed user, uint256 actualTokenCharge, uint256 actualGasCost, uint256 actualTokenPriceWithMarkup);

    event Received(address indexed sender, uint256 value);

    /// @notice All 'price' variables are multiplied by this value to avoid rounding up
    uint256 private constant PRICE_DENOMINATOR = 1e26;

    TokenPaymasterConfig public tokenPaymasterConfig;

    /// @notice Initializes the TokenPaymaster contract with the given parameters.
    /// @param _token The ERC20 token used for transaction fee payments.
    /// @param _entryPoint The EntryPoint contract used in the Account Abstraction infrastructure.
    /// @param _wrappedNative The ERC-20 token that wraps the native asset for current chain.
    /// @param _uniswap The Uniswap V3 SwapRouter contract.
    /// @param _tokenPaymasterConfig The configuration for the Token Paymaster.
    /// @param _oracleHelperConfig The configuration for the Oracle Helper.
    /// @param _uniswapHelperConfig The configuration for the Uniswap Helper.
    /// @param _owner The address that will be set as the owner of the contract.
    constructor(
        IERC20Metadata _token,
        IEntryPoint _entryPoint,
        IERC20 _wrappedNative,
        ISwapRouter _uniswap,
        TokenPaymasterConfig memory _tokenPaymasterConfig,
        OracleHelperConfig memory _oracleHelperConfig,
        UniswapHelperConfig memory _uniswapHelperConfig,
        address _owner
    )
    BasePaymaster(
    _entryPoint
    )
    OracleHelper(
    _oracleHelperConfig
    )
    UniswapHelper(
    _token,
    _wrappedNative,
    _uniswap,
    _uniswapHelperConfig
    )
    {
        setTokenPaymasterConfig(_tokenPaymasterConfig);
        transferOwnership(_owner);
    }

    /// @notice Updates the configuration for the Token Paymaster.
    /// @param _tokenPaymasterConfig The new configuration struct.
    function setTokenPaymasterConfig(
        TokenPaymasterConfig memory _tokenPaymasterConfig
    ) public onlyOwner {
        require(_tokenPaymasterConfig.priceMarkup <= 2 * PRICE_DENOMINATOR, "TPM: price markup too high");
        require(_tokenPaymasterConfig.priceMarkup >= PRICE_DENOMINATOR, "TPM: price markup too low");
        tokenPaymasterConfig = _tokenPaymasterConfig;
        emit ConfigUpdated(_tokenPaymasterConfig);
    }

    function setUniswapConfiguration(
        UniswapHelperConfig memory _uniswapHelperConfig
    ) external onlyOwner {
        _setUniswapHelperConfiguration(_uniswapHelperConfig);
    }

    /// @notice Allows the contract owner to withdraw a specified amount of tokens from the contract.
    /// @param to The address to transfer the tokens to.
    /// @param amount The amount of tokens to transfer.
    function withdrawToken(address to, uint256 amount) external onlyOwner {
        SafeERC20.safeTransfer(token, to, amount);
    }

    /// @notice Validates a paymaster user operation and calculates the required token amount for the transaction.
    /// @param userOp The user operation data.
    /// @param requiredPreFund The maximum cost (in native token) the paymaster has to prefund.
    /// @return context The context containing the token amount and user sender address (if applicable).
    /// @return validationResult A uint256 value indicating the result of the validation (always 0 in this implementation).
    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 requiredPreFund)
    internal
    override
    returns (bytes memory context, uint256 validationResult) {unchecked {
            uint256 priceMarkup = tokenPaymasterConfig.priceMarkup;
            uint256 dataLength = userOp.paymasterAndData.length - PAYMASTER_DATA_OFFSET;
            require(dataLength == 0 || dataLength == 32,
                "TPM: invalid data length"
            );
            uint256 maxFeePerGas = userOp.unpackMaxFeePerGas();
            uint256 refundPostopCost = tokenPaymasterConfig.refundPostopCost;
            require(refundPostopCost < userOp.unpackPostOpGasLimit(), "TPM: postOpGasLimit too low");
            uint256 preChargeNative = requiredPreFund + (refundPostopCost * maxFeePerGas);
        // note: as price is in native-asset-per-token and we want more tokens increasing it means dividing it by markup
            uint256 cachedPriceWithMarkup = cachedPrice * PRICE_DENOMINATOR / priceMarkup;
            if (dataLength == 32) {
                uint256 clientSuppliedPrice = uint256(bytes32(userOp.paymasterAndData[PAYMASTER_DATA_OFFSET : PAYMASTER_DATA_OFFSET + 32]));
                if (clientSuppliedPrice < cachedPriceWithMarkup) {
                    // note: smaller number means 'more native asset per token'
                    cachedPriceWithMarkup = clientSuppliedPrice;
                }
            }
            uint8 tokenDecimals = token.decimals();
            uint256 tokenAmount = weiToToken(
                preChargeNative, 
                tokenDecimals,
                cachedPriceWithMarkup
            );
            SafeERC20.safeTransferFrom(token, userOp.sender, address(this), tokenAmount);
            context = abi.encode(tokenAmount, userOp.sender);
            validationResult = _packValidationData(
                false,
                uint48(cachedPriceTimestamp + tokenPaymasterConfig.priceMaxAge),
                0
            );
        }
    }

    /// @notice Performs post-operation tasks, such as updating the token price and refunding excess tokens.
    /// @dev This function is called after a user operation has been executed or reverted.
    /// @param context The context containing the token amount and user sender address.
    /// @param actualGasCost The actual gas cost of the transaction.
    /// @param actualUserOpFeePerGas - the gas price this UserOp pays. This value is based on the UserOp's maxFeePerGas
    //      and maxPriorityFee (and basefee)
    //      It is not the same as tx.gasprice, which is what the bundler pays.
    function _postOp(PostOpMode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas) internal override {
        unchecked {
            uint256 priceMarkup = tokenPaymasterConfig.priceMarkup;
            (
                uint256 preCharge,
                address userOpSender
            ) = abi.decode(context, (uint256, address));
            uint256 _cachedPrice = updateCachedPrice(false);
        // note: as price is in native-asset-per-token and we want more tokens increasing it means dividing it by markup
            uint256 cachedPriceWithMarkup = _cachedPrice * PRICE_DENOMINATOR / priceMarkup;
        // Refund tokens based on actual gas cost
            uint256 actualChargeNative = actualGasCost + tokenPaymasterConfig.refundPostopCost * actualUserOpFeePerGas;
            uint8 tokenDecimals = token.decimals();
            uint256 actualTokenNeeded = weiToToken(
                actualChargeNative,
                tokenDecimals,
                cachedPriceWithMarkup
            );
            if (preCharge > actualTokenNeeded) {
                // If the initially provided token amount is greater than the actual amount needed, refund the difference
                SafeERC20.safeTransfer(
                    token,
                    userOpSender,
                    preCharge - actualTokenNeeded
                );
            } else if (preCharge < actualTokenNeeded) {
                // Attempt to cover Paymaster's gas expenses by withdrawing the 'overdraft' from the client
                // If the transfer reverts also revert the 'postOp' to remove the incentive to cheat
                SafeERC20.safeTransferFrom(
                    token,
                    userOpSender,
                    address(this),
                    actualTokenNeeded - preCharge
                );
            }

            emit UserOperationSponsored(userOpSender, actualTokenNeeded, actualGasCost, cachedPriceWithMarkup);
            refillEntryPointDeposit(_cachedPrice);
        }
    }

    /// @notice If necessary this function uses this Paymaster's token balance to refill the deposit on EntryPoint
    /// @param _cachedPrice the token price that will be used to calculate the swap amount.
    function refillEntryPointDeposit(uint256 _cachedPrice) private {
        uint256 currentEntryPointBalance = entryPoint.balanceOf(address(this));
        if (
            currentEntryPointBalance < tokenPaymasterConfig.minEntryPointBalance
        ) {
            uint256 swappedWeth = _maybeSwapTokenToWeth(token, _cachedPrice);
            unwrapWeth(swappedWeth);
            entryPoint.depositTo{value: address(this).balance}(address(this));
        }
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function withdrawEth(address payable recipient, uint256 amount) external onlyOwner {
        (bool success,) = recipient.call{value: amount}("");
        require(success, "withdraw failed");
    }
}
