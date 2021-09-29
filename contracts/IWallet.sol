// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./UserOperation.sol";

interface IWallet {

    // validate user's signature and nonce
    // @param requiredPrefund how much this wallet should pre-fund the transaction.
    // @note that after execution, the excess is sent back to the wallet.
    // @note if requiredPrefund is zero, the wallet MUST NOT send anything (the paymaster pays)
    function verifyUserOp(UserOperation calldata userOp, uint requiredPrefund) external;

}
