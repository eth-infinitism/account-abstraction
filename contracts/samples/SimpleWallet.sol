// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "../IWallet.sol";
import "hardhat/console.sol";

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

    constructor(address _singleton, address _owner) {
        singleton = _singleton;
        owner = _owner;
    }

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the singleton (which gets redirected through execFromSingleton)
        require(msg.sender == owner || msg.sender == address(this), "only owner");
    }

    function transfer(address payable dest, uint amount) external onlyOwner {
        dest.transfer(amount);
    }

    function exec(address dest, bytes calldata func) external onlyOwner {
        _call(dest,func);
    }

    function updateSingleton(address _singleton) external onlyOwner {
        emit SingletonChanged(singleton, _singleton);
        singleton = _singleton;
    }

    function payForSelfOp(UserOperation calldata userOp, uint requiredPrefund) external override {
        require(msg.sender == singleton, "wallet: not from Singleton");
        _validateSignature(userOp);
        _validateAndIncrementNonce(userOp);

        if (requiredPrefund != 0) {
            (bool success) = payable(msg.sender).send(requiredPrefund);
            (success);
            //ignore failure (its Singleton's job to verify, not wallet.)
        }
    }

    //called by singleton, only after payForSelfOp succeeded.
    function execFromSingleton(bytes calldata func) external override {
        require(msg.sender == singleton, "execFromSingleton: only from singleton" );
        // solhint-disable-next-line avoid-low-level-calls
        _call(address(this), func);
    }

    function _call(address target, bytes memory data) internal {
        (bool success, bytes memory result) = target.call(data);
        if (!success) {
            assembly {
                revert(result, add(result,32))
            }
        }
    }
    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        require(nonce++ == userOp.nonce, "wallet: invalid nonce");
    }

    function _validateSignature(UserOperation calldata userOp) internal view {

        bytes32 hash = userOp.hash();
        require(userOp.signature.length == 65, "wallet: invalid signature length");
        (bytes32 r, bytes32 s) = abi.decode(userOp.signature, (bytes32, bytes32));
        uint8 v = uint8(userOp.signature[64]);
        require(owner == ecrecover(hash, v, r, s), "wallet: wrong signature");
    }
}
