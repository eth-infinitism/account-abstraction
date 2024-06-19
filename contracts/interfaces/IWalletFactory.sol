// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

interface IWalletFactory {
  function getWalletTimestamp(address wallet) external view returns (uint256);
}
