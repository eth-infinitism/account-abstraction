// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "../IWallet.sol";
import "hardhat/console.sol";

//minimal wallet
// this is sample minimal wallet.
// has execute, eth handling methods
// has a single signer that can send requests through the entryPoint.
contract SimpleWallet is IWallet {
    using UserOperationLib for UserOperation;
    uint public nonce;
    address public owner;
    address public entryPoint;

    event EntryPointChanged(address oldEntryPoint, address newEntryPoint);

    receive() external payable {}

    constructor(address _entryPoint, address _owner) {
        entryPoint = _entryPoint;
        owner = _owner;
    }

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the entryPoint (which gets redirected through execFromEntryPoint)
        require(msg.sender == owner || msg.sender == address(this), "only owner");
    }

    function transfer(address payable dest, uint amount) external onlyOwner {
        dest.transfer(amount);
    }

    function exec(address dest, bytes calldata func) external onlyOwner {
        _call(dest, func);
    }

    function updateEntryPoint(address _entryPoint) external onlyOwner {
        emit EntryPointChanged(entryPoint, _entryPoint);
        entryPoint = _entryPoint;
    }

    function verifyUserOp(UserOperation calldata userOp, uint requiredPrefund) external override {
        require(msg.sender == entryPoint, "wallet: not from EntryPoint");
        _validateSignature(userOp);
        _validateAndIncrementNonce(userOp);

        if (requiredPrefund != 0) {
            (bool success) = payable(msg.sender).send(requiredPrefund);
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }

    //called by entryPoint, only after verifyUserOp succeeded.
    function execFromEntryPoint(bytes calldata func) external {
        require(msg.sender == entryPoint, "execFromEntryPoint: only from entryPoint");
        _call(address(this), func);
    }

    function _call(address sender, bytes memory data) internal {
        (bool success, bytes memory result) = sender.call(data);
        if (!success) {
            assembly {
                revert(result, add(result, 32))
            }
        }
    }

    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            require(nonce++ == userOp.nonce, "wallet: invalid nonce");
        }
    }

    function _validateSignature(UserOperation calldata userOp) internal view {

        bytes32 hash = userOp.hash();
        require(userOp.signature.length == 65, "wallet: invalid signature length");
        (bytes32 r, bytes32 s) = abi.decode(userOp.signature, (bytes32, bytes32));
        uint8 v = uint8(userOp.signature[64]);
        require(owner == ecrecover(hash, v, r, s), "wallet: wrong signature");
    }
}
