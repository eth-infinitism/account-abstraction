// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../IWallet.sol";

//minimal wallet
// this is sample minimal wallet.
// has execute, eth handling methods
// has a single signer that can send requests through the singleton.
contract SimpleWallet is IWallet {
    using UserOperationLib for UserOperation;
    uint public nonce;
    address public owner;
    address public singleton;

    receive() external payable {}

    constructor(address _singleton, address _owner) {
        singleton = _singleton;
        owner = _owner;
    }

    modifier onlyThroughSingleton() {
        _onlyThroughSingleton();
        _;
    }

    function _onlyThroughSingleton() internal view {
        require(msg.sender == address(this) || msg.sender == owner, "wallet: only through singleton or owner");
    }

    function transfer(address payable dest, uint amount) external onlyThroughSingleton {
        dest.transfer(amount);
    }

    function exec(address dest, bytes calldata func) external onlyThroughSingleton {
        (bool success,) = dest.call(func);
        require(success);
    }

    function updateSingleton(address _singleton) external onlyThroughSingleton {
        singleton = _singleton;
    }

    function payForSelfOp(UserOperation calldata userOp) external override {
        require(msg.sender == singleton, "wallet: not from Singleton");
        _validateSignature(userOp);
        _validateAndIncrementNonce(userOp);
        uint prepay = UserOperationLib.clientPrePay(userOp);
        if (prepay != 0) {
            payable(msg.sender).transfer(prepay);
        }
    }

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external override {
        require(msg.sender == singleton);
        // solhint-disable-next-line avoid-low-level-calls
        (bool success,) = address(this).call(func);
        require(success);
    }

    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        require(nonce++ == userOp.nonce, "wallet: invalid nonce");
    }

    function _validateSignature(UserOperation calldata userOp) internal view {

        require(owner == userOp.signer, "wallet: not owner");
        bytes32 hash = userOp.hash();
        require(userOp.signature.length==65, "wallet: invalid signature length");
        (bytes32 r, bytes32 s) = abi.decode(userOp.signature, (bytes32, bytes32));
        uint8 v = uint8(userOp.signature[64]);
        require(userOp.signer == ecrecover(hash, v, r, s), "wallet: wrong signature");
    }
}
