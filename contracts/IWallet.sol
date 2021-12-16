// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "./UserOperation.sol";

interface IWallet {

    /**
     * validate user's signature and nonce
     * must accept calls ONLY from entrypoint
     * @param userOp the operation that is about to be executed.
     * @param requiredPrefund how much this wallet should pre-fund the transaction.
     *         Should send this amount to sender (entrypoint)
     *         After execution, the excess is sent back to the wallet.
     * @dev if requiredPrefund is zero, the wallet MUST NOT send anything (the paymaster pays)
     */
    function verifyUserOp(UserOperation calldata userOp, uint requiredPrefund) external;
}
