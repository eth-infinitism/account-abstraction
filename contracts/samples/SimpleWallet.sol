// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "../IWallet.sol";
import "../EntryPoint.sol";

import "hardhat/console.sol";

//minimal wallet
// this is sample minimal wallet.
// has execute, eth handling methods
// has a single signer that can send requests through the entryPoint.
contract SimpleWallet is IWallet {
    using UserOperationLib for UserOperation;
    struct OwnerNonce {
        uint96 nonce;
        address owner;
    }
    OwnerNonce ownerNonce;
    EntryPoint public entryPoint;

    function nonce() public  view returns (uint) {
        return ownerNonce.nonce;
    }

    function owner() public view returns(address) {
        return ownerNonce.owner;
    }

    event EntryPointChanged(EntryPoint oldEntryPoint, EntryPoint newEntryPoint);

    receive() external payable {}

    constructor(EntryPoint _entryPoint, address _owner) {
        entryPoint = _entryPoint;
        ownerNonce.owner = _owner;
    }

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the entryPoint (which gets redirected through execFromEntryPoint)
        require(msg.sender == ownerNonce.owner || msg.sender == address(this), "only owner");
    }

    function transfer(address payable dest, uint amount) external onlyOwner {
        dest.transfer(amount);
    }

    function exec(address dest, uint value, bytes calldata func) external onlyOwner {
        _call(dest, value, func);
    }

    function updateEntryPoint(EntryPoint _entryPoint) external onlyOwner {
        emit EntryPointChanged(entryPoint, _entryPoint);
        entryPoint = _entryPoint;
    }

    function _requireFromEntryPoint() internal view {
        require(msg.sender == address(entryPoint), "wallet: not from EntryPoint");
    }

    function verifyUserOp(UserOperation calldata userOp, uint requiredPrefund) external override {
        _requireFromEntryPoint();
        _validateSignature(userOp);
        _validateAndIncrementNonce(userOp);
        _payPrefund(requiredPrefund);
    }

    function _payPrefund(uint requiredPrefund) internal {
        if (requiredPrefund != 0) {
            (bool success) = payable(msg.sender).send(requiredPrefund);
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }

    //called by entryPoint, only after verifyUserOp succeeded.
    function execFromEntryPoint(address dest, uint value, bytes calldata func) external {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            require(ownerNonce.nonce++ == userOp.nonce, "wallet: invalid nonce");
        }
    }

    function _validateSignature(UserOperation calldata userOp) internal view {

        bytes32 hash = userOp.hash();
        (bytes32 r, bytes32 s, uint8 v) = _rsv(userOp.signature);

        require(owner() == _ecrecover(hash, v, r, s), "wallet: wrong signature");
    }

    function _rsv(bytes calldata signature) internal pure returns (bytes32 r, bytes32 s, uint8 v) {

        require(signature.length == 65, "wallet: invalid signature length");
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
    }

    function _ecrecover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) internal pure returns (address) {
        return ecrecover(hash, v, r, s);
    }

    function _call(address sender, uint value, bytes memory data) internal {
        (bool success, bytes memory result) = sender.call{value : value}(data);
        if (!success) {
            assembly {
                revert(result, add(result, 32))
            }
        }
    }

    function addDeposit() public payable {
        entryPoint.addDeposit{value : msg.value}();
    }

    function withdrawDeposit(address payable withdrawAddress) public {
        entryPoint.withdrawStake(withdrawAddress);
    }
}
