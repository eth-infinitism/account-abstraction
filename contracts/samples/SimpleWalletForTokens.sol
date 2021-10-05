// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./SimpleWallet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

//in order to be created with tokens, the wallet has to have allowance to the paymaster in advance.
// the simplest strategy is assign the allowance in the constructor or init function
contract SimpleWalletForTokens is SimpleWallet {

    constructor(EntryPoint _entryPoint, address _owner, IERC20 token, address paymaster) SimpleWallet(_entryPoint, _owner) {
        token.approve(paymaster, type(uint).max);
    }
}
