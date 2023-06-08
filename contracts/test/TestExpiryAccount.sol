// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.12;

import "../samples/SimpleAccount.sol";

/**
 * A test account, for testing expiry.
 * add "temporary" owners, each with a time range (since..till) times for each.
 * NOTE: this is not a full "session key" implementation: a real session key should probably limit
 * other things, like target contracts and methods to be called.
 * also, the "since" value is not really useful, only for testing the entrypoint.
 */
contract TestExpiryAccount is SimpleAccount {
    using ECDSA for bytes32;

    struct PermissionParam {
        address whitelistDestination;
        bytes4[] whitelistMethods;
        uint256 tokenAmount;
    }
    // PermissionParam과 대응되는 mapping -> validateSignature에서 확인.
    mapping(address => uint48) public ownerAfter;
    mapping(address => uint48) public ownerUntil;

    // solhint-disable-next-line no-empty-blocks
    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint) {}


    function initialize(address anOwner) public virtual override initializer {
        super._initialize(anOwner);
        addTemporaryOwner(anOwner, 0, type(uint48).max);
    }

    // As this is a test contract, no need for proxy, so no need to disable init
    // solhint-disable-next-line no-empty-blocks
    function _disableInitializers() internal override {}

    function addTemporaryOwner(address owner, uint48 _after, uint48 _until, PermissionParam[] calldata permissions) public onlyOwner {
        require(_until > _after, "wrong until/after");
        ownerAfter[owner] = _after;
        ownerUntil[owner] = _until;
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, PermissionParam[] calldata permissions)
    internal override view returns (uint256 validationData) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address signer = hash.recover(userOp.signature);
        uint48 _until = ownerUntil[signer];
        uint48 _after = ownerAfter[signer];
        
        // we have "until" value for all valid owners. so zero means "invalid signature"
        bool sigFailed = _until == 0;
        if (sigFailed) {
            return _packValidationData(sigFailed, _until, _after);
        }
        
        // All external function call is made through execute(address dest, uint256 value, bytes calldata func) at SimpleAccount.sol 
        if (getSelector(calldataCopy) != "0xdade6037") {
            sigFailed = true;
            // _packValidationData defined at core/Helper.sol
            return _packValidationData(sigFailed, _until, _after);
        }

        (address dest, uint256 value, bytes memory func) = decode(userOp.calldata);

        uint256 permissionLength = permissions.length;
        for(uint i; i < permissionLength; i++) {
            PermissionParam memory permission = permissions[i];
            if (permission.whitelistDestination == dest) {
                uint256 permissionMethodsLength = permission.whitelistMethods.length;
                if (permissionMethodsLength > 0) {
                    for(uint j; j < permissionMethodsLength; j++) {
                        if (permission.whitelistMethods[j] == getSelector(userOp.calldata)) {
                            sigFailed = true;
                            break;
                        }
                    }
                }
            }
            return _packValidationData(sigFailed, _until, _after);
        }
    }

    

    function getSelector(bytes calldata _data) public pure returns (bytes4 selector) {
        selector = bytes4(_data[0:4]);
    }

    function decode(bytes calldata userOpCalldata) public pure returns (address dest, uint256 value, bytes memory func){
        (dest, value, func) = abi.decode(userOpCalldata[4:], (address, uint256, bytes));
    }

}