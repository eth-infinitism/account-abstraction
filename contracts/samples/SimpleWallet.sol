// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "./BaseWallet.sol";

//minimal wallet
// this is sample minimal wallet.
// has execute, eth handling methods
// has a single signer that can send requests through the entryPoint.
contract SimpleWallet is BaseWallet {
    using UserOperationLib for UserOperation;

    //explicit sizes of nonce, to fit a single storage cell with "owner"
    uint96 private _nonce;
    address public owner;

    function nonce() public view virtual override returns (uint256) {
        return _nonce;
    }

    function entryPoint() public view virtual override returns (EntryPoint) {
        return _entryPoint;
    }

    EntryPoint private _entryPoint;

    event EntryPointChanged(EntryPoint indexed oldEntryPoint, EntryPoint indexed newEntryPoint);

    receive() external payable {}

    constructor(EntryPoint anEntryPoint, address anOwner) {
        _entryPoint = anEntryPoint;
        owner = anOwner;
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

    function updateEntryPoint(EntryPoint newEntryPoint) external onlyOwner {
        emit EntryPointChanged(_entryPoint, newEntryPoint);
        _entryPoint = newEntryPoint;
    }

    function _requireFromEntryPoint() internal override view {
        require(msg.sender == address(entryPoint()), "wallet: not from EntryPoint");
    }

    //called by entryPoint, only after validateUserOp succeeded.
    function execFromEntryPoint(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPoint();
        _call(dest, value, func);
    }

    /// implement template method of BaseWallet
    function _validateAndIncrementNonce(UserOperation calldata userOp) internal override {
        require(_nonce++ == userOp.nonce, "wallet: invalid nonce");
    }

    /// implement template method of BaseWallet
    function _validateSignature(UserOperation calldata userOp, bytes32 requestId) internal view override {
        require(owner == _recoverSigner(userOp, requestId), "wallet: wrong signature");
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
        return entryPoint().balanceOf(address(this));
    }

    function addDeposit() public payable {

        (bool req,) = address(entryPoint()).call{value : msg.value}("");
        require(req);
    }

    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) public onlyOwner{
        entryPoint().withdrawTo(withdrawAddress, amount);
    }
}
