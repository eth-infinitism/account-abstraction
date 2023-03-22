// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
  constructor() ERC20("TST", "TestToken") {} // solhint-disable-line no-empty-blocks

  function mint(address sender, uint256 amount) external {
    _mint(sender, amount);
  }
}
