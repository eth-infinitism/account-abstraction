// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/utils/Address.sol";

interface IERC725X {
    /**
     * @notice Emitted when deploying a contract
     * @param operationType The opcode used to deploy the contract (CREATE or CREATE2)
     * @param contractAddress The created contract address
     * @param value The amount of native tokens (in Wei) sent to fund the created contract address
     * @param salt The salt used in case of CREATE2. Will be bytes32(0) in case of CREATE operation
     */
    event ContractCreated(
        uint256 indexed operationType,
        address indexed contractAddress,
        uint256 indexed value,
        bytes32 salt
    );

    /**
     * @notice Emitted when calling an address (EOA or contract)
     * @param operationType The low-level call opcode used to call the `to` address (CALL, STATICALL or DELEGATECALL)
     * @param target The address to call. `target` will be unused if a contract is created (operation types 1 and 2).
     * @param value The amount of native tokens transferred with the call (in Wei)
     * @param selector The first 4 bytes (= function selector) of the data sent with the call
     */
    event Executed(
        uint256 indexed operationType,
        address indexed target,
        uint256 indexed value,
        bytes4 selector
    );

    /**
     * @param operationType The operation type used: CALL = 0; CREATE = 1; CREATE2 = 2; STATICCALL = 3; DELEGATECALL = 4
     * @param target The address of the EOA or smart contract.  (unused if a contract is created via operation type 1 or 2)
     * @param value The amount of native tokens to transfer (in Wei)
     * @param data The call data, or the creation bytecode of the contract to deploy
     *
     * @dev Generic executor function to:
     *
     * - send native tokens to any address.
     * - interact with any contract by passing an abi-encoded function call in the `data` parameter.
     * - deploy a contract by providing its creation bytecode in the `data` parameter.
     *
     * Requirements:
     *
     * - SHOULD only be callable by the owner of the contract set via ERC173.
     * - if a `value` is provided, the contract MUST have at least this amount in its balance to execute successfully.
     * - if the operation type is STATICCALL or DELEGATECALL, `value` SHOULD be 0.
     * - `target` SHOULD be address(0) when deploying a contract.
     *
     * Emits an {Executed} event, when a call is made with `operationType` 0 (CALL), 3 (STATICCALL) or 4 (DELEGATECALL)
     * Emits a {ContractCreated} event, when deploying a contract with `operationType` 1 (CREATE) or 2 (CREATE2)
     */
    function execute(
        uint256 operationType,
        address target,
        uint256 value,
        bytes memory data
    ) external payable returns (bytes memory);

    /**
     * @param operationsType The list of operations type used: CALL = 0; CREATE = 1; CREATE2 = 2; STATICCALL = 3; DELEGATECALL = 4
     * @param targets The list of addresses to call. `targets` will be unused if a contract is created (operation types 1 and 2).
     * @param values The list of native token amounts to transfer (in Wei)
     * @param datas The list of call data, or the creation bytecode of the contract to deploy
     *
     * @dev Generic batch executor function to:
     *
     * - send native tokens to any address.
     * - interact with any contract by passing an abi-encoded function call in the `datas` parameter.
     * - deploy a contract by providing its creation bytecode in the `datas` parameter.
     *
     * Requirements:
     *
     * - The length of the parameters provided MUST be equal
     * - SHOULD only be callable by the owner of the contract set via ERC173.
     * - if a `values` is provided, the contract MUST have at least this amount in its balance to execute successfully.
     * - if the operation type is STATICCALL or DELEGATECALL, `values` SHOULD be 0.
     * - `targets` SHOULD be address(0) when deploying a contract.
     *
     * Emits an {Executed} event, when a call is made with `operationType` 0 (CALL), 3 (STATICCALL) or 4 (DELEGATECALL)
     * Emits a {ContractCreated} event, when deploying a contract with `operationType` 1 (CREATE) or 2 (CREATE2)
     */
    function execute(
        uint256[] memory operationsType,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory datas
    ) external payable returns (bytes[] memory);
}

// ERC165 INTERFACE IDs
bytes4 constant _INTERFACEID_ERC725X = 0x570ef073;

// ERC725X OPERATION TYPES
uint256 constant OPERATION_0_CALL = 0;
uint256 constant OPERATION_1_CREATE = 1;
uint256 constant OPERATION_2_CREATE2 = 2;
uint256 constant OPERATION_3_STATICCALL = 3;
uint256 constant OPERATION_4_DELEGATECALL = 4;

/**
 * @dev reverts when trying to send more native tokens `value` than available in current `balance`.
 * @param balance the balance of the ERC725X contract.
 * @param value the amount of native tokens sent via `ERC725X.execute(...)`.
 */
error ERC725X_InsufficientBalance(uint256 balance, uint256 value);

/**
 * @dev reverts when the `operationTypeProvided` is none of the default operation types available.
 * (CALL = 0; CREATE = 1; CREATE2 = 2; STATICCALL = 3; DELEGATECALL = 4)
 */
error ERC725X_UnknownOperationType(uint256 operationTypeProvided);

/**
 * @dev the `value` parameter (= sending native tokens) is not allowed when making a staticcall
 * via `ERC725X.execute(...)` because sending native tokens is a state changing operation.
 */
error ERC725X_MsgValueDisallowedInStaticCall();

/**
 * @dev the `value` parameter (= sending native tokens) is not allowed when making a delegatecall
 * via `ERC725X.execute(...)` because msg.value is persisting.
 */
error ERC725X_MsgValueDisallowedInDelegateCall();

/**
 * @dev reverts when passing a `to` address while deploying a contract va `ERC725X.execute(...)`
 * whether using operation type 1 (CREATE) or 2 (CREATE2).
 */
error ERC725X_CreateOperationsRequireEmptyRecipientAddress();

/**
 * @dev reverts when contract deployment via `ERC725X.execute(...)` failed.
 * whether using operation type 1 (CREATE) or 2 (CREATE2).
 */
error ERC725X_ContractDeploymentFailed();

/**
 * @dev reverts when no contract bytecode was provided as parameter when trying to deploy a contract
 * via `ERC725X.execute(...)`, whether using operation type 1 (CREATE) or 2 (CREATE2).
 */
error ERC725X_NoContractBytecodeProvided();

/**
 * @dev reverts when there is not the same number of operation, to addresses, value, and data.
 */
error ERC725X_ExecuteParametersLengthMismatch();

abstract contract ERC725X is IERC725X {
    /**
     * @inheritdoc IERC725X
     */
    function execute(
        uint256 operationType,
        address target,
        uint256 value,
        bytes memory data
    ) public payable virtual returns (bytes memory);

    /**
     * @inheritdoc IERC725X
     */
    function execute(
        uint256[] memory operationsType,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory datas
    ) public payable virtual returns (bytes[] memory result);

    function _execute(
        uint256 operationType,
        address target,
        uint256 value,
        bytes memory data
    ) internal virtual returns (bytes memory) {
        // CALL
        if (operationType == OPERATION_0_CALL) {
            return _executeCall(target, value, data);
        }

        // Deploy with CREATE
        if (operationType == uint256(OPERATION_1_CREATE)) {
            if (target != address(0))
                revert ERC725X_CreateOperationsRequireEmptyRecipientAddress();
            return _deployCreate(value, data);
        }

        // Deploy with CREATE2
        if (operationType == uint256(OPERATION_2_CREATE2)) {
            if (target != address(0))
                revert ERC725X_CreateOperationsRequireEmptyRecipientAddress();
            return _deployCreate2(value, data);
        }

        // STATICCALL
        if (operationType == uint256(OPERATION_3_STATICCALL)) {
            if (value != 0) revert ERC725X_MsgValueDisallowedInStaticCall();
            return _executeStaticCall(target, data);
        }

        // DELEGATECALL
        //
        // WARNING! delegatecall is a dangerous operation type! use with EXTRA CAUTION
        //
        // delegate allows to call another deployed contract and use its functions
        // to update the state of the current calling contract.
        //
        // this can lead to unexpected behaviour on the contract storage, such as:
        // - updating any state variables (even if these are protected)
        // - update the contract owner
        // - run selfdestruct in the context of this contract
        //
        if (operationType == uint256(OPERATION_4_DELEGATECALL)) {
            if (value != 0) revert ERC725X_MsgValueDisallowedInDelegateCall();
            return _executeDelegateCall(target, data);
        }

        revert ERC725X_UnknownOperationType(operationType);
    }

    /**
     * @dev perform low-level call (operation type = 0)
     * @param target The address on which call is executed
     * @param value The value to be sent with the call
     * @param data The data to be sent with the call
     * @return result The data from the call
     */
    function _executeCall(
        address target,
        uint256 value,
        bytes memory data
    ) internal virtual returns (bytes memory result) {
        emit Executed(OPERATION_0_CALL, target, value, bytes4(data));

        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory returnData) = target.call{value: value}(
            data
        );
        result = Address.verifyCallResult(
            success,
            returnData,
            "ERC725X: Unknown Error"
        );
    }

    /**
     * @dev perform low-level staticcall (operation type = 3)
     * @param target The address on which staticcall is executed
     * @param data The data to be sent with the staticcall
     * @return result The data returned from the staticcall
     */
    function _executeStaticCall(address target, bytes memory data)
        internal
        virtual
        returns (bytes memory result)
    {
        emit Executed(OPERATION_3_STATICCALL, target, 0, bytes4(data));

        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory returnData) = target.staticcall(data);
        result = Address.verifyCallResult(
            success,
            returnData,
            "ERC725X: Unknown Error"
        );
    }

    /**
     * @dev perform low-level delegatecall (operation type = 4)
     * @param target The address on which delegatecall is executed
     * @param data The data to be sent with the delegatecall
     * @return result The data returned from the delegatecall
     */
    function _executeDelegateCall(address target, bytes memory data)
        internal
        virtual
        returns (bytes memory result)
    {
        emit Executed(OPERATION_4_DELEGATECALL, target, 0, bytes4(data));

        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory returnData) = target.delegatecall(data);
        result = Address.verifyCallResult(
            success,
            returnData,
            "ERC725X: Unknown Error"
        );
    }

    /**
     * @dev deploy a contract using the CREATE opcode (operation type = 1)
     * @param value The value to be sent to the contract created
     * @param creationCode The contract creation bytecode to deploy appended with the constructor argument(s)
     * @return newContract The address of the contract created as bytes
     */
    function _deployCreate(uint256 value, bytes memory creationCode)
        internal
        virtual
        returns (bytes memory newContract)
    {
        if (creationCode.length == 0) {
            revert ERC725X_NoContractBytecodeProvided();
        }

        address contractAddress;
        // solhint-disable no-inline-assembly
        assembly {
            contractAddress := create(
                value,
                add(creationCode, 0x20),
                mload(creationCode)
            )
        }

        if (contractAddress == address(0)) {
            revert ERC725X_ContractDeploymentFailed();
        }

        newContract = abi.encodePacked(contractAddress);
        emit ContractCreated(
            OPERATION_1_CREATE,
            contractAddress,
            value,
            bytes32(0)
        );
    }

    /**
     * @dev deploy a contract using the CREATE2 opcode (operation type = 2)
     * @param value The value to be sent to the contract created
     * @param creationCode The contract creation bytecode to deploy appended with the constructor argument(s) and a bytes32 salt
     * @return newContract The address of the contract created as bytes
     */
    function _deployCreate2(uint256 value, bytes memory creationCode)
        internal
        virtual
        returns (bytes memory newContract)
    {
        bytes32 salt = BytesLib.toBytes32(
            creationCode,
            creationCode.length - 32
        );
        bytes memory bytecode = BytesLib.slice(
            creationCode,
            0,
            creationCode.length - 32
        );

        address contractAddress;
        require(
            address(this).balance >= value,
            "Create2: insufficient balance"
        );
        require(creationCode.length != 0, "Create2: bytecode length is zero");
        /// @solidity memory-safe-assembly
        assembly {
            contractAddress := create2(
                value,
                add(bytecode, 0x20),
                mload(bytecode),
                salt
            )
        }
        require(contractAddress != address(0), "Create2: Failed on deploy");

        newContract = abi.encodePacked(contractAddress);
        emit ContractCreated(OPERATION_2_CREATE2, contractAddress, value, salt);
    }
}
