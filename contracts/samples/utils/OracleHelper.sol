// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

/* solhint-disable not-rely-on-time */

import "./IOracle.sol";

/// @title Helper functions for dealing with various forms of price feed oracles.
/// @notice Maintains a price cache and updates the current price if needed.
/// In the best case scenario we have a direct oracle from the token to the native asset.
/// Also support tokens that have no direct price oracle to the native asset.
/// Sometimes oracles provide the price in the opposite direction of what we need in the moment.
abstract contract OracleHelper {

    event TokenPriceUpdated(uint256 currentPrice, uint256 previousPrice, uint256 cachedPriceTimestamp);

    uint256 private constant PRICE_DENOMINATOR = 1e26;

    struct OracleHelperConfig {

        /// @notice The price cache will be returned without even fetching the oracles for this number of seconds
        uint48 cacheTimeToLive;

        /// @notice The maximum acceptable age of the price oracle round
        uint48 maxOracleRoundAge;

        /// @notice The Oracle contract used to fetch the latest token prices
        IOracle tokenOracle;

        /// @notice The Oracle contract used to fetch the latest native asset prices. Only needed if tokenToNativeOracle flag is not set.
        IOracle nativeOracle;

        /// @notice If 'true' we will fetch price directly from tokenOracle
        /// @notice If 'false' we will use nativeOracle to establish a token price through a shared third currency
        bool tokenToNativeOracle;

        /// @notice 'false' if price is bridging-asset-per-token (or native-asset-per-token), 'true' if price is tokens-per-bridging-asset
        bool tokenOracleReverse;

        /// @notice 'false' if price is bridging-asset-per-native-asset, 'true' if price is native-asset-per-bridging-asset
        bool nativeOracleReverse;

        /// @notice The price update threshold percentage from PRICE_DENOMINATOR that triggers a price update (1e26 = 100%)
        uint256 priceUpdateThreshold;

    }

    /// @notice The cached token price from the Oracle, always in (native-asset-per-token) * PRICE_DENOMINATOR format
    uint256 public cachedPrice;

    /// @notice The timestamp of a block when the cached price was updated
    uint48 public cachedPriceTimestamp;

    OracleHelperConfig private oracleHelperConfig;

    /// @notice The "10^(tokenOracle.decimals)" value used for the price calculation
    uint128 private tokenOracleDecimalPower;

    /// @notice The "10^(nativeOracle.decimals)" value used for the price calculation
    uint128 private nativeOracleDecimalPower;

    constructor (
        OracleHelperConfig memory _oracleHelperConfig
    ) {
        cachedPrice = type(uint256).max; // initialize the storage slot to invalid value
        _setOracleConfiguration(
            _oracleHelperConfig
        );
    }

    function _setOracleConfiguration(
        OracleHelperConfig memory _oracleHelperConfig
    ) private {
        oracleHelperConfig = _oracleHelperConfig;
        require(_oracleHelperConfig.priceUpdateThreshold <= PRICE_DENOMINATOR, "TPM: update threshold too high");
        tokenOracleDecimalPower = uint128(10 ** oracleHelperConfig.tokenOracle.decimals());
        if (oracleHelperConfig.tokenToNativeOracle) {
            require(address(oracleHelperConfig.nativeOracle) == address(0), "TPM: native oracle must be zero");
            nativeOracleDecimalPower = 1;
        } else {
            nativeOracleDecimalPower = uint128(10 ** oracleHelperConfig.nativeOracle.decimals());
        }
    }

    /// @notice Updates the token price by fetching the latest price from the Oracle.
    /// @param force true to force cache update, even if called after short time or the change is lower than the update threshold.
    /// @return newPrice the new cached token price
    function updateCachedPrice(bool force) public returns (uint256) {
        uint256 cacheTimeToLive = oracleHelperConfig.cacheTimeToLive;
        uint256 cacheAge = block.timestamp - cachedPriceTimestamp;
        if (!force && cacheAge <= cacheTimeToLive) {
            return cachedPrice;
        }
        uint256 priceUpdateThreshold = oracleHelperConfig.priceUpdateThreshold;
        IOracle tokenOracle = oracleHelperConfig.tokenOracle;
        IOracle nativeOracle = oracleHelperConfig.nativeOracle;

        uint256 _cachedPrice = cachedPrice;
        uint256 tokenPrice = fetchPrice(tokenOracle);
        uint256 nativeAssetPrice = 1;
        // If the 'TokenOracle' returns the price in the native asset units there is no need to fetch native asset price
        if (!oracleHelperConfig.tokenToNativeOracle) {
            nativeAssetPrice = fetchPrice(nativeOracle);
        }
        uint256 newPrice = calculatePrice(
            tokenPrice,
            nativeAssetPrice,
            oracleHelperConfig.tokenOracleReverse,
            oracleHelperConfig.nativeOracleReverse
        );
        uint256 priceRatio = PRICE_DENOMINATOR * newPrice / _cachedPrice;
        bool updateRequired = force ||
            priceRatio > PRICE_DENOMINATOR + priceUpdateThreshold ||
            priceRatio < PRICE_DENOMINATOR - priceUpdateThreshold;
        if (!updateRequired) {
            return _cachedPrice;
        }
        cachedPrice = newPrice;
        cachedPriceTimestamp = uint48(block.timestamp);
        emit TokenPriceUpdated(newPrice, _cachedPrice, cachedPriceTimestamp);
        return newPrice;
    }

    /**
     * Calculate the effective price of the selected token denominated in native asset.
     *
     * @param tokenPrice - the price of the token relative to a native asset or a bridging asset like the U.S. dollar.
     * @param nativeAssetPrice - the price of the native asset relative to a bridging asset or 1 if no bridging needed.
     * @param tokenOracleReverse - flag indicating direction of the "tokenPrice".
     * @param nativeOracleReverse - flag indicating direction of the "nativeAssetPrice".
     * @return the native-asset-per-token price multiplied by the PRICE_DENOMINATOR constant.
     */
    function calculatePrice(
        uint256 tokenPrice,
        uint256 nativeAssetPrice,
        bool tokenOracleReverse,
        bool nativeOracleReverse
    ) private view returns (uint256){
        // tokenPrice is normalized as bridging-asset-per-token
        if (tokenOracleReverse) {
            // inverting tokenPrice that was tokens-per-bridging-asset (or tokens-per-native-asset)
            tokenPrice = PRICE_DENOMINATOR * tokenOracleDecimalPower / tokenPrice;
        } else {
            // tokenPrice already bridging-asset-per-token (or native-asset-per-token)
            tokenPrice = PRICE_DENOMINATOR * tokenPrice / tokenOracleDecimalPower;
        }

        if (nativeOracleReverse) {
            // multiplying by nativeAssetPrice that is native-asset-per-bridging-asset
            // => result = (bridging-asset / token) * (native-asset / bridging-asset) = native-asset / token
            return nativeAssetPrice * tokenPrice / nativeOracleDecimalPower;
        } else {
            // dividing by nativeAssetPrice that is bridging-asset-per-native-asset
            // => result = (bridging-asset / token) / (bridging-asset / native-asset) = native-asset / token
            return tokenPrice * nativeOracleDecimalPower / nativeAssetPrice;
        }
    }

    /// @notice Fetches the latest price from the given Oracle.
    /// @dev This function is used to get the latest price from the tokenOracle or nativeOracle.
    /// @param _oracle The Oracle contract to fetch the price from.
    /// @return price The latest price fetched from the Oracle.
    function fetchPrice(IOracle _oracle) internal view returns (uint256 price) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = _oracle.latestRoundData();
        require(answer > 0, "TPM: Chainlink price <= 0");
        require(updatedAt >= block.timestamp - oracleHelperConfig.maxOracleRoundAge, "TPM: Incomplete round");
        require(answeredInRound >= roundId, "TPM: Stale price");
        price = uint256(answer);
    }
}
