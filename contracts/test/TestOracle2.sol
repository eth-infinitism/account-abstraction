pragma solidity ^0.8.0;

import "../samples/utils/IOracle.sol";

contract TestOracle2 is IOracle {
    int256 public price;

    constructor() {
        price = 100000000;
    }

    function setPrice(int256 _price) external {
        price = _price;
    }

    function decimals() external pure override returns (uint8) {
        return 8;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        // solhint-disable-next-line not-rely-on-time
        return (73786976294838215802, price, 1680509051, block.timestamp, 73786976294838215802);
    }
}
