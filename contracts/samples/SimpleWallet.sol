// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

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

    //explicit sizes of nonce, to fit a single storage cell with "owner"
    uint96 public nonce;
    address public owner;

    EntryPoint public entryPoint;

    event EntryPointChanged(EntryPoint indexed oldEntryPoint, EntryPoint indexed newEntryPoint);

    receive() external payable {}

    constructor(EntryPoint _entryPoint, address _owner) {
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

    function transfer(address payable dest, uint256 amount) external onlyOwner {
        dest.transfer(amount);
    }

    function exec(address dest, uint256 value, bytes calldata func) external onlyOwner {
        _call(dest, value, func);
    }

    function execBatch(address[] calldata dest, bytes[] calldata func) external onlyOwner {
        require(dest.length == func.length, "wrong array lengths");
        for (uint256 i = 0; i < dest.length; i++) {
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

    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, uint256 missingWalletFunds) external override {
        _requireFromEntryPoint();
        _validateSignature(userOp, requestId);
        _validateAndIncrementNonce(userOp);
        _payPrefund(missingWalletFunds);
    }

    function _payPrefund(uint256 requiredPrefund) internal {
        if (requiredPrefund != 0) {
            //pay required prefund. make sure NOT to use the "gas" opcode, which is banned during validateUserOp
            // (and used by default by the "call")
            (bool success,) = payable(msg.sender).call{value : requiredPrefund, gas : type(uint256).max}("");
            (success);
            //ignore failure (it's EntryPoint's job to verify, not wallet.)
        }
    }

    //called by entryPoint, only after validateUserOp succeeded.
    function execFromEntryPoint(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    function _validateAndIncrementNonce(UserOperation calldata userOp) internal {
        //during construction, the "nonce" field hold the salt.
        // if we assert it is zero, then we allow only a single wallet per owner.
        if (userOp.initCode.length == 0) {
            require(nonce++ == userOp.nonce, "wallet: invalid nonce");
        }
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 requestId) internal view {
        bytes32 hash = requestId.toEthSignedMessageHash();
        require(owner == hash.recover(userOp.signature), "wallet: wrong signature");
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value : value}(data);
        if (!success) {
            assembly {
                revert(add(result,32), mload(result))
            }
        }
    }

    function getDeposit() public view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function addDeposit() public payable {

        (bool req,) = address(entryPoint).call{value : msg.value}("");
        require(req);
    }

    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) public onlyOwner{
        entryPoint.withdrawTo(withdrawAddress, amount);
    }
}
