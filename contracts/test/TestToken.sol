// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor ()
        ERC20("TST", "TestToken") {
    }

    function mint(address sender, uint256 amount) external {
        _mint(sender, amount);
    }
}
