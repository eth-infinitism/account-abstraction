// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "./UserOperation.sol";

interface IWallet {

    // validate user's signature and nonce
    //  must use clientPrePay to prepay for the TX
    function payForSelfOp(UserOperation calldata userOp) external;

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external;
}
