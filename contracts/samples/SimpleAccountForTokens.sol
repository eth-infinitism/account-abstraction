// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./SampleAcct.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

//in order to be created with tokens, the account has to have allowance to the paymaster in advance.
// the simplest strategy is assign the allowance in the constructor or init function
contract SampleAcctForTokens is SampleAcct {

    constructor(IEntryPoint _entryPoint, address _owner, IERC20 token, address paymaster) SampleAcct(_entryPoint, _owner) {
        token.approve(paymaster, type(uint256).max);
    }
}
