// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

// Import the required libraries and contracts
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import "../core/EntryPoint.sol";
import "../core/BasePaymaster.sol";
import "./utils/UniswapHelper.sol";
import "./utils/OracleHelper.sol";

/// @title Sample ERC-20 Token Paymaster for ERC-4337
/// @notice Based on Pimlico 'PimlicoERC20Paymaster' and OpenGSN 'PermitERC20UniswapV3Paymaster'
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
    uint256 public constant REFUND_POSTOP_COST = 40000; // Estimated gas cost for refunding tokens after the transaction is completed

    struct TokenPaymasterConfig {
        /// @notice The price markup percentage applied to the token price (1e6 = 100%)
        uint256 priceMarkup;

        /// @notice exchange tokens to native currency if the EntryPoint balance of this Paymaster falls below this value
        uint256 minEntryPointBalance;

        /// @notice exchange tokens to native currency if the token balance of this Paymaster exceeds this value
        uint256 maxTokenBalance;
    }

    // The token, tokenOracle, and nativeAssetOracle are declared as immutable,
    // meaning their values cannot change after contract creation.
    IERC20 public immutable token; // The ERC20 token used for transaction fee payments

    TokenPaymasterConfig private tokenPaymasterConfig;

    event ConfigUpdated(TokenPaymasterConfig tokenPaymasterConfig);

    event UserOperationSponsored(address indexed user, uint256 actualTokenCharge, uint256 actualGasCost, uint256 actualTokenPrice);

    // TODO: I don't like defaults in Solidity - accept ALL parameters of fail!!!
    /// @notice Initializes the PimlicoERC20Paymaster contract with the given parameters.
    /// @param _token The ERC20 token used for transaction fee payments.
    /// @param _entryPoint The EntryPoint contract used in the Account Abstraction infrastructure.
    /// @ param _tokenOracle The Oracle contract used to fetch the latest token prices.
    /// @ param _nativeAssetOracle The Oracle contract used to fetch the latest native asset (ETH, Matic, Avax, etc.) prices.
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
    _oracleHelperConfig,
    10 ** _token.decimals()
    )
    UniswapHelper(
    _wrappedNative,
    _uniswap,
    _uniswapHelperConfig
    )
    {
        token = _token;
        setTokenPaymasterConfig(_tokenPaymasterConfig);
        //        tokenOracle = _tokenOracle; // oracle for token -> usd
        //        nativeAssetOracle = _nativeAssetOracle;
        //        priceMarkup = 110e4; // 110%  1e6 = 100%
        transferOwnership(_owner);
    }

    /// @notice Updates the configuration for the Token Paymaster.
    /// @param _tokenPaymasterConfig The new price markup percentage (1e6 = 100%).
    function setTokenPaymasterConfig(
        TokenPaymasterConfig memory _tokenPaymasterConfig
    ) public onlyOwner {
        require(_tokenPaymasterConfig.priceMarkup <= 120e4, "TPM: price markup too high");
        require(_tokenPaymasterConfig.priceMarkup >= 1e6, "TPM: price markeup too low");
        tokenPaymasterConfig = _tokenPaymasterConfig;
        emit ConfigUpdated(_tokenPaymasterConfig);
    }

    function setOracleConfiguration(
        OracleHelperConfig memory _oracleHelperConfig
    ) external onlyOwner {
        _setOracleConfiguration(_oracleHelperConfig);
    }

    function setOracleConfiguration(
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
    /// @param requiredPreFund The amount of tokens required for pre-funding.
    /// @return context The context containing the token amount and user sender address (if applicable).
    /// @return validationResult A uint256 value indicating the result of the validation (always 0 in this implementation).
    function _validatePaymasterUserOp(UserOperation calldata userOp, bytes32, uint256 requiredPreFund)
    internal
    override
    returns (bytes memory context, uint256 validationResult)
    {
        uint256 priceMarkup = tokenPaymasterConfig.priceMarkup;
        unchecked {
            uint256 paymasterAndDataLength = userOp.paymasterAndData.length - 20;
            require(paymasterAndDataLength == 0 || paymasterAndDataLength == 32,
                "TPM: invalid data length"
            );
        // NOTE: we assumed that nativeAsset's decimals is 18, if there is any nativeAsset with different decimals, need to change the 1e18 to the correct decimals
            uint256 tokenAmount = (requiredPreFund + (REFUND_POSTOP_COST * userOp.maxFeePerGas)) * priceMarkup
            * cachedPrice / PRICE_DENOMINATOR / PRICE_DENOMINATOR; // 2xPRICE_DENOMINATOR to cancel out 'priceMarkup * cachedPrice' denominators
        //            if (length == 32) {
        //                require(
        //                    tokenAmount <= uint256(bytes32(userOp.paymasterAndData[20:52])), "TPM: token amount too high"
        //                );
        //            }
            SafeERC20.safeTransferFrom(token, userOp.sender, address(this), tokenAmount);
            context = abi.encodePacked(tokenAmount, userOp.sender);
        // No return here since validationData == 0 and we have context saved in memory
            validationResult = 0;
        }
    }

    /// @notice Performs post-operation tasks, such as updating the token price and refunding excess tokens.
    /// @dev This function is called after a user operation has been executed or reverted.
    /// @param mode The post-operation mode (either successful or reverted).
    /// @param context The context containing the token amount and user sender address.
    /// @param actualGasCost The actual gas cost of the transaction.
    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) internal override {
        if (mode == PostOpMode.postOpReverted) {
            return; // Do nothing here to not revert the whole bundle and harm reputation
        }
        uint256 priceMarkup = tokenPaymasterConfig.priceMarkup;
        uint256 cachedPrice = updatePrice(false);
        unchecked {
        // Refund tokens based on actual gas cost
        // NOTE: we assumed that nativeAsset's decimals is 18, if there is any nativeAsset with different decimals, need to change the 1e18 to the correct decimals
            uint256 actualTokenNeeded = (actualGasCost + REFUND_POSTOP_COST * tx.gasprice) * priceMarkup * cachedPrice
            / PRICE_DENOMINATOR / PRICE_DENOMINATOR; // 2xPRICE_DENOMINATOR to cancel out 'priceMarkup * cachedPrice' denominators
        // TODO: We use tx.gasprice here since we don't know the actual gas price used by the user
        // TODO: encode the 'maxFeePerGas' into context - using 'tx.gasprice' breaks this Paymaster as it may be way way above UserOp 'maxFeePerGas' and fail the postOp unnecessarily
            if (uint256(bytes32(context[0 : 32])) > actualTokenNeeded) {
                // If the initially provided token amount is greater than the actual amount needed, refund the difference
                SafeERC20.safeTransfer(
                    token,
                    address(bytes20(context[32 : 52])),
                    uint256(bytes32(context[0 : 32])) - actualTokenNeeded
                );
            } // If the token amount is not greater than the actual amount needed, no refund occurs

            emit UserOperationSponsored(address(bytes20(context[32 : 52])), actualTokenNeeded, actualGasCost, cachedPrice);
        }
    }
}
