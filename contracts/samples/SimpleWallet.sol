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

    event SingletonChanged(address oldSingleton, address newSingleton);

    receive() external payable {}

    function init(address _singleton, address _owner) public virtual {
        require(singleton == address(0), "wallet: already initialized");
        require(_singleton != address(0), "wallet: cannot have null singleton");
        singleton = _singleton;
        owner = _owner;
    }

    modifier onlyThroughSingleton() {
        _onlyThroughSingleton();
        _;
    }

    //complete wallet creation: set singleton and pay for creation.
    // can only be called directly after creation, while singleton is not set
    function payForCreation(address payable target, uint amount, address _singleton) external {
        require(singleton == address(0), "singleton already set");
        singleton = _singleton;
        target.transfer(amount);
    }

    function _onlyThroughSingleton() internal view {
        require(msg.sender == singleton || msg.sender == owner, "wallet: only through singleton or owner");
    }

    function transfer(address payable dest, uint amount) external onlyThroughSingleton {
        dest.transfer(amount);
    }

    function exec(address dest, bytes calldata func) external onlyThroughSingleton {
        (bool success,) = dest.call(func);
        require(success);
    }

    function updateSingleton(address _singleton) external onlyThroughSingleton {
        emit SingletonChanged(singleton, _singleton);
        singleton = _singleton;
    }

    function payForSelfOp(UserOperation calldata userOp, uint requiredPrefund) external override {
        require(singleton == address(0) || msg.sender == singleton, "wallet: not from Singleton");
        _validateSignature(userOp);
        _validateAndIncrementNonce(userOp);

        if (requiredPrefund != 0) {
            (bool success) = payable(msg.sender).send(requiredPrefund);
            (success);  //ignore failure (its Singleton's job to verify, not wallet.)
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

        require(owner == address(0) || owner == userOp.signer, "wallet: not owner");
        bytes32 hash = userOp.hash();
        require(userOp.signature.length == 65, "wallet: invalid signature length");
        (bytes32 r, bytes32 s) = abi.decode(userOp.signature, (bytes32, bytes32));
        uint8 v = uint8(userOp.signature[64]);
        require(userOp.signer == ecrecover(hash, v, r, s), "wallet: wrong signature");
    }
}
