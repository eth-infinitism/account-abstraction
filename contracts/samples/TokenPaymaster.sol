// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

// Import the required libraries and contracts
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import "../core/EntryPoint.sol";
import "../core/BasePaymaster.sol";
import "./utils/IOracle.sol";
import "./utils/UniswapHelper.sol";

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
contract TokenPaymaster is BasePaymaster, UniswapHelper {
    uint256 public constant PRICE_DENOMINATOR = 1e6;
    uint256 public constant REFUND_POSTOP_COST = 40000; // Estimated gas cost for refunding tokens after the transaction is completed

    // The token, tokenOracle, and nativeAssetOracle are declared as immutable,
    // meaning their values cannot change after contract creation.
    IERC20 public immutable token; // The ERC20 token used for transaction fee payments
    uint256 public immutable tokenDecimals;
    IOracle public immutable tokenOracle; // The Oracle contract used to fetch the latest token prices
    IOracle public immutable nativeAssetOracle; // The Oracle contract used to fetch the latest ETH prices

    uint192 public previousPrice; // The cached token price from the Oracle
    uint32 public priceMarkup; // The price markup percentage applied to the token price (1e6 = 100%)
    uint32 public priceUpdateThreshold; // The price update threshold percentage that triggers a price update (1e6 = 100%)

    event ConfigUpdated(uint32 priceMarkup, uint32 updateThreshold);

    event UserOperationSponsored(address indexed user, uint256 actualTokenCharge, uint256 actualGasCost, uint256 actualTokenPrice);

    /// @notice Initializes the PimlicoERC20Paymaster contract with the given parameters.
    /// @param _token The ERC20 token used for transaction fee payments.
    /// @param _entryPoint The EntryPoint contract used in the Account Abstraction infrastructure.
    /// @param _tokenOracle The Oracle contract used to fetch the latest token prices.
    /// @param _nativeAssetOracle The Oracle contract used to fetch the latest native asset (ETH, Matic, Avax, etc.) prices.
    /// @param _owner The address that will be set as the owner of the contract.
    constructor(
        IERC20Metadata _token,
        IEntryPoint _entryPoint,
        IOracle _tokenOracle,
        IOracle _nativeAssetOracle,
        address _owner
    ) BasePaymaster(_entryPoint) {
        token = _token;
        tokenOracle = _tokenOracle; // oracle for token -> usd
        nativeAssetOracle = _nativeAssetOracle; // oracle for native asset(eth/matic/avax..) -> usd
        priceMarkup = 110e4; // 110%  1e6 = 100%
        priceUpdateThreshold = 25e3; // 2.5%  1e6 = 100%
        transferOwnership(_owner);
        tokenDecimals = 10 ** _token.decimals();
        require(_tokenOracle.decimals() == 8, "TPM:token oracle decimals not 8");
        require(_nativeAssetOracle.decimals() == 8, "TPM:native oracle decimals not 8");
    }

    /// @notice Updates the price markup and price update threshold configurations.
    /// @param _priceMarkup The new price markup percentage (1e6 = 100%).
    /// @param _updateThreshold The new price update threshold percentage (1e6 = 100%).
    function updateConfig(uint32 _priceMarkup, uint32 _updateThreshold) external onlyOwner {
        require(_priceMarkup <= 120e4, "TPM: price markup too high");
        require(_priceMarkup >= 1e6, "TPM: price markeup too low");
        require(_updateThreshold <= 1e6, "TPM: update threshold too high");
        priceMarkup = _priceMarkup;
        priceUpdateThreshold = _updateThreshold;
        emit ConfigUpdated(_priceMarkup, _updateThreshold);
    }

    /// @notice Allows the contract owner to withdraw a specified amount of tokens from the contract.
    /// @param to The address to transfer the tokens to.
    /// @param amount The amount of tokens to transfer.
    function withdrawToken(address to, uint256 amount) external onlyOwner {
        SafeERC20.safeTransfer(token, to, amount);
    }

    /// @notice Updates the token price by fetching the latest price from the Oracle.
    function updatePrice() public {
        // This function updates the cached ERC20/ETH price ratio
        uint192 tokenPrice = fetchPrice(tokenOracle);
        uint192 nativeAssetPrice = fetchPrice(nativeAssetOracle);
        previousPrice = nativeAssetPrice * uint192(tokenDecimals) / tokenPrice;
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
        unchecked {
            uint256 cachedPrice = previousPrice;
            require(cachedPrice != 0, "TPM: price not set");
            uint256 length = userOp.paymasterAndData.length - 20;
        // 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdf is the mask for the last 6 bits 011111 which mean length should be 100000(32) || 000000(0)
            require(
                length & 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffdf == 0,
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
        unchecked {
            uint192 tokenPrice = fetchPrice(tokenOracle);
            uint192 nativeAsset = fetchPrice(nativeAssetOracle);
            uint256 cachedPrice = previousPrice;
            uint192 price = nativeAsset * uint192(tokenDecimals) / tokenPrice;
            if (
                uint256(price) * PRICE_DENOMINATOR / cachedPrice > PRICE_DENOMINATOR + priceUpdateThreshold
                || uint256(price) * PRICE_DENOMINATOR / cachedPrice < PRICE_DENOMINATOR - priceUpdateThreshold
            ) {
                // TODO: WTF? CALL 'updatePrice' HERE!
                previousPrice = uint192(int192(price));
                cachedPrice = uint192(int192(price));
            }
        // Refund tokens based on actual gas cost
        // NOTE: we assumed that nativeAsset's decimals is 18, if there is any nativeAsset with different decimals, need to change the 1e18 to the correct decimals
            uint256 actualTokenNeeded = (actualGasCost + REFUND_POSTOP_COST * tx.gasprice) * priceMarkup * cachedPrice
            / PRICE_DENOMINATOR / PRICE_DENOMINATOR; // 2xPRICE_DENOMINATOR to cancel out 'priceMarkup * cachedPrice' denominators
            // TODO: We use tx.gasprice here since we don't know the actual gas price used by the user
            // TODO: encode the 'maxFeePerGas' into context - using 'tx.gasprice' breaks this Paymaster as it may be way way above UserOp 'maxFeePerGas' and fail the postOp unnecessarily
            if (uint256(bytes32(context[0:32])) > actualTokenNeeded) {
                // If the initially provided token amount is greater than the actual amount needed, refund the difference
                SafeERC20.safeTransfer(
                    token,
                    address(bytes20(context[32:52])),
                    uint256(bytes32(context[0:32])) - actualTokenNeeded
                );
            } // If the token amount is not greater than the actual amount needed, no refund occurs

            emit UserOperationSponsored(address(bytes20(context[32:52])), actualTokenNeeded, actualGasCost, cachedPrice);
        }
    }

    /// @notice Fetches the latest price from the given Oracle.
    /// @dev This function is used to get the latest price from the tokenOracle or nativeAssetOracle.
    /// @param _oracle The Oracle contract to fetch the price from.
    /// @return price The latest price fetched from the Oracle.
    function fetchPrice(IOracle _oracle) internal view returns (uint192 price) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = _oracle.latestRoundData();
        require(answer > 0, "TPM: Chainlink price <= 0");
        // 2 days old price is considered stale since the price is updated every 24 hours
        // solhint-disable-next-line not-rely-on-time
        require(updatedAt >= block.timestamp - 60 * 60 * 24 * 2, "TPM: Incomplete round");
        require(answeredInRound >= roundId, "TPM: Stale price");
        price = uint192(int192(answer));
    }
}
