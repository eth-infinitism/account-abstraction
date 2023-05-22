// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable not-rely-on-time */

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "./IOracle.sol";

/// @title Helper functions for dealing with various forms of price feed oracles.
/// @notice Maintains a price cache and updates the current price if needed.
/// In the best case scenario we have a direct oracle from the token to the native asset.
/// Also support tokens that have no direct price oracle to the native asset.
/// Sometimes oracles provide the price in the opposite direction of what we need in the moment.
abstract contract OracleHelper {

    event TokenPriceUpdated(uint256 currentPrice, uint256 previousPrice);

    uint256 private constant PRICE_DENOMINATOR = 1e6;

    /// @notice Actually equals 10^(token.decimals) value used for the price calculation
    uint256 private immutable tokenDecimalPower;

    struct OracleHelperConfig {
        /// @notice The Oracle contract used to fetch the latest token prices
        IOracle tokenOracle;

        /// @notice The Oracle contract used to fetch the latest ETH prices
        IOracle nativeOracle;

        /// @notice If 'true' we will fetch price directly from tokenOracle
        /// @notice If 'false' we will use nativeOracle to establish a token price through a shared third currency
        bool tokenToNativeOracle;

        /// @notice 'true' if price is dollars-per-token, 'false' if price is tokens-per-dollar
        bool tokenOracleReverse;

        /// @notice 'true' if price is dollars-per-ether, 'false' if price is ether-per-dollar
        bool nativeOracleReverse;

        /// @notice The price update threshold percentage that triggers a price update (1e6 = 100%)
        uint256 priceUpdateThreshold;

        /// @notice The price cache will be returned without even fetching the oracles for this number of seconds
        uint256 cacheTimeToLive;
    }

    /// @notice The cached token price from the Oracle, always in (ether-per-token) * PRICE_DENOMINATOR format
    uint256 public cachedPrice;

    /// @notice The timestamp of a block when the cached price was updated
    uint256 public cachedPriceTimestamp;

    OracleHelperConfig private oracleHelperConfig;

    constructor (
        OracleHelperConfig memory _oracleHelperConfig,
        uint256 _tokenDecimalPower
    ) {
        cachedPrice = type(uint256).max; // initialize the storage slot to invalid value
        tokenDecimalPower = _tokenDecimalPower;
        _setOracleConfiguration(
            _oracleHelperConfig
        );
    }

    function _setOracleConfiguration(
        OracleHelperConfig memory _oracleHelperConfig
    ) internal {
        oracleHelperConfig = _oracleHelperConfig;
        require(_oracleHelperConfig.priceUpdateThreshold <= 1e6, "TPM: update threshold too high");
    }

    /// @notice Updates the token price by fetching the latest price from the Oracle.
    function updateCachedPrice(bool force) public returns (uint256 newPrice) {
        uint256 cacheTimeToLive = oracleHelperConfig.cacheTimeToLive;
        uint256 priceUpdateThreshold = oracleHelperConfig.priceUpdateThreshold;
        IOracle tokenOracle = oracleHelperConfig.tokenOracle;
        IOracle nativeOracle = oracleHelperConfig.nativeOracle;

        uint256 cacheAge = block.timestamp - cachedPriceTimestamp;
        if (!force && cacheAge <= cacheTimeToLive) {
            return cachedPrice;
        }
        uint256 _cachedPrice = cachedPrice;
        uint256 tokenPrice = fetchPrice(tokenOracle);
        uint256 nativeAssetPrice = fetchPrice(nativeOracle);
        uint256 price = nativeAssetPrice * tokenDecimalPower / tokenPrice;
        uint256 priceNewByOld = price * PRICE_DENOMINATOR / _cachedPrice;

        bool updateRequired = force ||
            priceNewByOld > PRICE_DENOMINATOR + priceUpdateThreshold ||
            priceNewByOld < PRICE_DENOMINATOR - priceUpdateThreshold;
        if (!updateRequired) {
            return _cachedPrice;
        }
        uint256 previousPrice = _cachedPrice;
        _cachedPrice = nativeAssetPrice * tokenDecimalPower / tokenPrice;
        cachedPrice = _cachedPrice;
        emit TokenPriceUpdated(_cachedPrice, previousPrice);
        return _cachedPrice;
    }

    /// @notice Fetches the latest price from the given Oracle.
    /// @dev This function is used to get the latest price from the tokenOracle or nativeOracle.
    /// @param _oracle The Oracle contract to fetch the price from.
    /// @return price The latest price fetched from the Oracle.
    function fetchPrice(IOracle _oracle) internal view returns (uint256 price) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = _oracle.latestRoundData();
        require(answer > 0, "TPM: Chainlink price <= 0");
        // 2 days old price is considered stale since the price is updated every 24 hours
        require(updatedAt >= block.timestamp - 60 * 60 * 24 * 2, "TPM: Incomplete round");
        require(answeredInRound >= roundId, "TPM: Stale price");
        price = uint256(answer);
    }
}
