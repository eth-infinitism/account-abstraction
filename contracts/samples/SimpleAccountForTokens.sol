// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./SimpleAccount.sol";

//in order to be created with tokens, the account has to have allowance to the paymaster in advance.
// the simplest strategy is assign the allowance in the constructor or init function
contract SimpleAccountForTokens is SimpleAccount {

    function initialize(IEntryPoint _entryPoint, address _owner, IERC20 token, address paymaster) public virtual initializer {
        super.initialize(_entryPoint, _owner);
        token.approve(paymaster, type(uint256).max);
    }
}
