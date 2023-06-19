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

    bytes4 constant FUNCTION_EXECUTE = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 constant FUNCTION_EXECUTE_BATCH = bytes4(keccak256("executeBatch(address[],bytes[])"));
    uint256 constant DATE_LENGTH = 6;

    struct PermissionParam {
        address whitelistDestination;
        bytes4[] whitelistMethods;
    }
    
    struct PermissionStorage {
	    mapping(address => bool) whitelistDestinationMap;
	    mapping(address => mapping(bytes4 => bytes)) whitelistMethodPeriods;
	    mapping(address => mapping(bytes4 => bool)) whitelistMethodsMap;
    }

    mapping(address => PermissionStorage) internal permissionMap;

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

        PermissionStorage storage _permissionStorage = permissionMap[owner];
        
        for (uint256 index = 0; index < permissions.length; index++) {
            PermissionParam memory permission = permissions[index];
            address whitelistedDestination = permission.whitelistDestination;

            _permissionStorage.whitelistDestinationMap[whitelistedDestination] = true;

            for (uint256 methodIndex = 0; methodIndex < permission.whitelistMethods.length; methodIndex++) {
                // total 96 bits : | 48 bits - _after | 48 bits - _until |
                bytes4 permissionMethod = permission.whitelistMethods[methodIndex];
                _permissionStorage.whitelistMethodPeriods[whitelistedDestination][
                    permission.whitelistMethods[methodIndex]
                ]
                = abi.encodePacked(_after, _until);
                _permissionStorage.whitelistMethodsMap[whitelistedDestination][permissionMethod] = true;
            }
        }
    }

    // implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
    internal view override returns (uint256 validationData) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        address signer = hash.recover(userOp.signature);
        
        if (signer == owner) {
            return _packValidationData(true, 0, type(uint48).max);
        }
        bytes4 userOpSelector = getSelector(userOp.callData);
        return _validateSessionKey(userOp.callData, signer, userOpSelector);
        
    }

    function _validateSessionKey(bytes calldata userOpCallData, address signer, bytes4 userOpSelector) 
    internal view returns (uint256 validationData) {
        address[] memory dest; 
        bytes[] memory func;
        bool sigFailed = true;
        uint48 _after;
        uint48 _until;

        if (userOpSelector == FUNCTION_EXECUTE) {
            (dest, func) = _decodeSingle(userOpCallData); 	
        } else if (userOpSelector == FUNCTION_EXECUTE_BATCH) {
            (dest, func) = _decodeBatch(userOpCallData);
        } else {
            return _packValidationData(sigFailed, 0, 0);
        }

        PermissionStorage storage permissionStorage = permissionMap[signer];

        uint256 length = dest.length;
        for (uint256 i = 0; i < length; i++) {
            if (permissionStorage.whitelistDestinationMap[dest[i]]) {
                bytes4 selec = this.getSelector(func[i]);
                if (permissionStorage.whitelistMethodsMap[dest[i]][selec]) {
                    (_after, _until) = _decode(permissionStorage.whitelistMethodPeriods[dest[i]][selec]);
                    if(_after <= block.timestamp && _until >= block.timestamp) {
                        sigFailed = false;
                        return _packValidationData(sigFailed, _until, _after);
                    }
                }
            }
        }
        // Returning last retrieved until & after information 
        return _packValidationData(sigFailed, _until, _after);
    }

    function getSelector(bytes calldata _data) public pure returns (bytes4 selector) {
        selector = bytes4(_data[0:4]);
    }

    function _decodeSingle(bytes calldata _data) internal pure returns (address[] memory dest, bytes[] memory func){
        dest = new address[](1);
        func = new bytes[](1);
        (dest[0], , func[0]) = abi.decode(_data[4:], (address, uint256, bytes));
    }

    function _decodeBatch(bytes calldata _data) internal pure returns (address[] memory dest, bytes[] memory func){
        (dest, func) = abi.decode(_data[4:], (address[], bytes[]));
    }

    function _decode(bytes memory _data) internal pure returns (uint48 _after, uint48 _until) {
        assembly {
            _after := mload(add(_data, DATE_LENGTH))
            _until := mload(add(_data, mul(DATE_LENGTH, 2)))
        }
    }
}
