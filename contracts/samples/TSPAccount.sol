// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "../interfaces/ITSPAccount.sol";
import "./SimpleAccount.sol";

/**
 * minimal account.
 *  this is sample minimal account.
 *  has execute, eth handling methods
 *  has a single signer that can send requests through the entryPoint.
 */
contract TSPAccount is SimpleAccount, ITSPAccount {
    // the operator can invoke the contract, but cannot modify the owner
    address public _operator;

    // a guardian contract through which the owner can modify the guardian and multi-signature rules
    address public _guardian;

    mapping(string => string) private _metadata;

    event ResetOwner(
        address indexed account,
        address oldOwner,
        address newOwner
    );

    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint) {}

    function resetOwner(address newOwner) external {
        _requireFromEntryPointOrOwnerOrGuardian();
        ResetOwner(address(this), owner, newOwner);
        owner = newOwner;
    }

    function changeOperator(address operator) public {
        _requireFromEntryPointOrOwner();
        _operator = operator;
    }

    // Require the function call went through EntryPoint or owner or guardian
    function _requireFromEntryPointOrOwnerOrGuardian() internal view {
        require(
            msg.sender == address(entryPoint()) ||
                msg.sender == owner ||
                msg.sender == _guardian,
            "account: not Owner or EntryPoint or Guardian"
        );
    }

    // Require the function call went through EntryPoint or owner or operator
    function _requireFromEntryPointOrOwnerOrOperator() internal view {
        require(
            msg.sender == address(entryPoint()) ||
                msg.sender == owner ||
                msg.sender == _operator,
            "account: not Owner or EntryPoint or Guardian"
        );
    }

    // Save the user's customized data
    function setMetadata(
        string memory key,
        string memory value
    ) public onlyOwner {
        bytes memory bytesStr = bytes(value);
        if (bytesStr.length == 0) {
            delete _metadata[key];
        }
        _metadata[key] = value;
    }

    // Get user custom data
    function getMetadata(
        string memory key
    ) public view onlyOwner returns (string memory value) {
        value = _metadata[key];
        if (bytes(value).length == 0) {
            return "";
        }
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeTo()`
     */
    function initialize(address anOwner) public override initializer {
        _initialize(anOwner);
    }

    function changeGuardian(address guardian) public onlyOwner {
        _guardian = guardian;
    }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     */
    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external override {
        _requireFromEntryPointOrOwnerOrOperator();
        _call(dest, value, func);
    }

    /**
     * execute a sequence of transactions
     */
    function executeBatch(
        address[] calldata dest,
        bytes[] calldata func
    ) external override {
        _requireFromEntryPointOrOwnerOrOperator();
        require(dest.length == func.length, "wrong array lengths");
        for (uint256 i = 0; i < dest.length; i++) {
            _call(dest[i], 0, func[i]);
        }
    }
}
