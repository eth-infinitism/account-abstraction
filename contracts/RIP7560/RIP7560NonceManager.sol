// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

contract RIP7560NonceManager {
    address private entryPoint;

    mapping (address => mapping(uint192 => uint64)) private nonces;

    constructor(address _entryPoint){
        entryPoint = _entryPoint;
    }

    // The production NonceManager will not emit events
    event NonceIncrease(address account, uint192 key, uint64 newNonce);

    fallback(bytes calldata data) external returns (bytes memory) {
        address account = address(bytes20(data[:20]));
        uint192 key = uint192(bytes24(data[20:44]));
        uint64 nonce = uint64(bytes8(data[44:53]));
        if (msg.sender == entryPoint){
            require(nonces[account][key]++ == nonce, "nonce mismatch");
            emit NonceIncrease(account, key, nonces[account][key]);
            return "";
        }
        else {
            return abi.encodePacked(nonces[account][key]);
        }
    }
}
