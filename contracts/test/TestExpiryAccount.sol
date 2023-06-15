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

    bytes4 FUNCTION_EXECUTE = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 FUNCTION_EXECUTE_BATCH = bytes4(keccak256("executeBatch(address[],bytes[])"));

    // struct TokenApproval {
	//     bool enable;
	//     uint256 amount;
    // }

    struct PermissionParam {
        address whitelistDestination;
        bytes4[] whitelistMethods;
        // uint256 tokenAmount;
    }
    
    struct PermissionStorage {
	    address[] whitelistDestinations;
	    mapping(address => bool) whitelistDestinationMap;
	    mapping(address => bytes4[]) whitelistMethods;
	    mapping(address => mapping(bytes4 => bool)) whitelistMethodsMap;
	    // mapping(address => TokenApproval) tokenApprovals; 
    }

    mapping(address => PermissionStorage) internal permissionMap;

    mapping(address => uint48) public ownerAfter;
    mapping(address => uint48) public ownerUntil;

    // solhint-disable-next-line no-empty-blocks
    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint) {}


    function initialize(address anOwner) public virtual override initializer {
        super._initialize(anOwner);
        PermissionParam[] memory permissions = new PermissionParam[](0);
        this.addTemporaryOwner(anOwner, 0, type(uint48).max, permissions);
    }

    // As this is a test contract, no need for proxy, so no need to disable init
    // solhint-disable-next-line no-empty-blocks
    function _disableInitializers() internal override {}

    function addTemporaryOwner(address owner, uint48 _after, uint48 _until, PermissionParam[] calldata permissions) public onlyOwner {
        require(_until > _after, "wrong until/after");
        ownerAfter[owner] = _after;
        ownerUntil[owner] = _until;
	
        PermissionStorage storage _permissionStorage = permissionMap[owner];
        address[] memory whitelistAddresses = new address[] (permissions.length);
        
        for (uint256 index = 0; index < permissions.length; index++) {
            PermissionParam memory permission = permissions[index];
            address whitelistedDestination = permission.whitelistDestination;
            whitelistAddresses[index] = whitelistedDestination;

            _permissionStorage.whitelistDestinationMap[whitelistedDestination] = true;
            _permissionStorage.whitelistMethods[whitelistedDestination] = permission.whitelistMethods;

            for (uint256 methodIndex = 0; methodIndex < permission.whitelistMethods.length; methodIndex++) {
            _permissionStorage.whitelistMethodsMap[whitelistedDestination] [
                    permission.whitelistMethods[methodIndex]
                ] = true;
            }

            // if (permission.tokenAmount > 0) {
            // _permissionStorage.tokenApprovals[whitelistedDestination] = TokenApproval({enable: true, amount: permission.tokenAmount});
            // }
        }
        _permissionStorage.whitelistDestinations = whitelistAddresses;
    }

    // implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
    internal view override returns (uint256 validationData) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address signer = hash.recover(userOp.signature);
        uint48 _until = ownerUntil[signer];
        uint48 _after = ownerAfter[signer];
        
        // we have "until" value for all valid owners. so zero means "invalid signature"
        bool sigFailed = _until == 0;
        if (sigFailed) {
            return _packValidationData(sigFailed, _until, _after);
        }

        if (signer == owner) {
            return _packValidationData(sigFailed, _until, _after);
        } else {
            bytes4 userOpSelector = getSelector(userOp.callData);
            return _validateSessionKey(userOp.callData, signer, _until, _after, userOpSelector);
        }
    }

    function _validateSessionKey(bytes calldata userOpCallData, address signer, uint48 _until, uint48 _after, bytes4 userOpSelector) 
    internal view returns (uint256 validationData) {
        address[] memory dest; 
        bytes[] memory func;
        bool sigFailed = true;

        if (userOpSelector == FUNCTION_EXECUTE) {
            (dest, , func) = _decodeSingle(userOpCallData); 	
        } else if (userOpSelector == FUNCTION_EXECUTE_BATCH) {
            (dest, func) = _decodeBatch(userOpCallData);
        } else {
            return _packValidationData(sigFailed, _until, _after);
        }

        PermissionStorage storage permissionStorage = permissionMap[signer];

        uint256 length = dest.length;
        for (uint256 i = 0; i < length; i++) {
            if (permissionStorage.whitelistDestinationMap[dest[i]]) {
                if (permissionStorage.whitelistMethodsMap[dest[i]][this.getSelector(func[i])]) {
                    sigFailed = false;
                    break;
                }
            }
        }
        return _packValidationData(sigFailed, _until, _after);
    }

    function getSelector(bytes calldata _data) public pure returns (bytes4 selector) {
        selector = bytes4(_data[0:4]);
    }

    function _decodeSingle(bytes calldata _data) internal pure returns (address[] memory dest, uint256 value, bytes[] memory func){
        dest = new address[](1);
        func = new bytes[](1);
        (dest[0], value, func[0]) = abi.decode(_data[4:], (address, uint256, bytes));
    }

    function _decodeBatch(bytes calldata _data) internal pure returns (address[] memory dest, bytes[] memory func){
        (dest, func) = abi.decode(_data[4:], (address[], bytes[]));
    }

}