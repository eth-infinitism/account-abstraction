// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./UserOperation.sol";

interface IAccountExecute {
    /**
     * Account MAY implement this execute method.
     * passing this methodSig as callData will cause the entryPoint to pass the full UserOp (and hash)
     * to the account.
     * @param userOp              - The operation that was just validated.
     * @param userOpHash          - Hash of the user's request data.
     */
    function executeUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external;
}
