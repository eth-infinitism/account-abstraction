// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "../IWallet.sol";
import "../EntryPoint.sol";
import "./ECDSA.sol";

//minimal wallet
// this is sample minimal wallet.
// has execute, eth handling methods
// has a single signer that can send requests through the entryPoint.
contract SimpleWallet is IWallet {
    using ECDSA for bytes32;
    using UserOperationLib for UserOperation;
    struct OwnerNonce {
        uint96 nonce;
        address owner;
    }

    OwnerNonce ownerNonce;
    EntryPoint public entryPoint;

    function nonce() public view returns (uint) {
        return ownerNonce.nonce;
    }

    function owner() public view returns (address) {
        return ownerNonce.owner;
    }

    event EntryPointChanged(EntryPoint indexed oldEntryPoint, EntryPoint indexed newEntryPoint);

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

    function execBatch(address[] calldata dest, bytes[] calldata func) external onlyOwner {
        require(dest.length == func.length, "wrong array lengths");
        for (uint i = 0; i < dest.length; i++) {
            _call(dest[i], 0, func[i]);
        }
    }

    function updateEntryPoint(EntryPoint _entryPoint) external onlyOwner {
        emit EntryPointChanged(entryPoint, _entryPoint);
        entryPoint = _entryPoint;
    }

    function _requireFromEntryPoint() internal view {
        require(msg.sender == address(entryPoint), "wallet: not from EntryPoint");
    }

    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, uint requiredPrefund) external override {
        _requireFromEntryPoint();
        _validateSignature(userOp, requestId);
        _validateAndIncrementNonce(userOp);
        _payPrefund(requiredPrefund);
    }

    function _payPrefund(uint requiredPrefund) internal {
        if (requiredPrefund != 0) {
            //pay required prefund. make sure NOT to use the "gas" opcode, which is banned during validateUserOp
            // (and used by default by the "call")
            (bool success,) = payable(msg.sender).call{value : requiredPrefund, gas : type(uint).max}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
    }

    //called by entryPoint, only after validateUserOp succeeded.
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

    function _validateSignature(UserOperation calldata userOp, bytes32 requestId) internal view {
        bytes32 hash = requestId.toEthSignedMessageHash();
        require(owner() == hash.recover(userOp.signature), "wallet: wrong signature");
    }

    function _call(address sender, uint value, bytes memory data) internal {
        (bool success, bytes memory result) = sender.call{value : value}(data);
        if (!success) {
            assembly {
                revert(add(result,32), mload(result))
            }
        }
    }

    function getDeposit() public view returns (uint) {
        return entryPoint.balanceOf(address(this));
    }

    function addDeposit() public payable {

        (bool req,) = address(entryPoint).call{value : msg.value}("");
        require(req);
    }

    function withdrawDepositTo(address payable withdrawAddress, uint amount) public onlyOwner{
        entryPoint.withdrawTo(withdrawAddress, amount);
    }
}
