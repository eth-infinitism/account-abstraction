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
        addTemporaryOwner(anOwner, 0, type(uint48).max);
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
            _permissionStorage.whitelistMethods[whitelistedDestination] = permission.whitelistedMethods;

            for (uint256 methodIndex = 0; methodIndex < permission.whitelistMethods.length; methodIndex++) {
            _permissionStorage.whitelistMethodsMap[whitelistedDestination] [
                    permission.whitelistMethods[methodIndex]
                ] = true;
            }

            if (permission.tokenAmount > 0) {
            _permissionStorage.tokenApprovals[whitelistedDestination] = TokenApproval({enable: true, amount: permission.tokenAmount});
            }
        }
        _permissionStorage.whitelistDestinations = whitelistAddresses;
    }

    // implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
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

        if (signer == owner) {
            return _packValidationData(sigFailed, _until, _after);
        } else {
            bytes4 userOpSelector = getSelector(userOp.callData);

            if (userOpSelector != FUNCTION_EXECUTE || userOpSelector != FUNCTION_EXECUTE_BATCH) {
                return _packValidationData(sigFailed, _until, _after);
            } 

            userOpSelector == FUNCTION_EXECUTE
                ? return _validateSessionKeySingle(userOp.callData, signer, _until, _after);
                : return _validateSessionKeyBatch(userOp.callData, signer, _until, _after);
        }
    }

    function _validateSessionKeySingle(bytes calldata userOpCallData, address signer, uint48 _until, uint48 _after) 
    internal returns (uint256 validationData) {       
        (address dest, uint256 value, bytes memory func) = decodeSingle(userOpCallData);
        PermissionStorage memory permissionStorage = permissionMap[signer];

        bool sigFailed = true;

        if (permissionStorage.whitelistDestinationMap[dest]) {
            if (permissionStorage.whitelistMethodsMap[dest][getSelector(func)]) {
                    sigFailed = false;
                    return _packValidationData(sigFailed, _until, _after);
                }
            } 
        }
        return _packValidationData(sigFailed, _until, _after);
        
    }

    function _validateSessionKeyBatch(bytes calldata userOpCallData, address signer, uint48 _until, uint48 _after) 
    internal returns (uint256 validationData) {
        (address[] dest, bytes[] func) = decodeBatch(userOpCallData);
        PermissionStorage memory permissionStorage = permissionMap[signer];

        bool sigFailed = true;

        uint256 length = dest.length;
        for (uint256 i = 0; i < length; i++) {
            if (permissionStorage.whitelistDestinationMap[dest[i]]) {
                if (permissionStorage.whitelistMethodsMap[dest[i]][getSelector(func[i])]) {
                    sigFailed = false;
                    break;
                    // Token Approval??
                }
                sigFailed = true;
            }
        }
        return _packValidationData(sigFailed, _until, _after);
    }

    function getSelector(bytes calldata _data) public pure returns (bytes4 selector) {
        selector = bytes4(_data[0:4]);
    }

    function decodeSingle(bytes calldata _data) public pure returns (address dest, uint256 value, bytes memory func){
        (dest, value, func) = abi.decode(_data[4:], (address, uint256, bytes));
    }

    function decodeBatch(bytes calldata _data) public pure returns (address[] memory dest, bytes[] memory func){
        (dest, func) = abi.decode(_data[4:], (address[], bytes[]));
    }

}