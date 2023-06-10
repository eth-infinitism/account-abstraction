// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

import "../core/BaseAccount.sol";
import "./callback/TokenCallbackHandler.sol";
/**
  * minimal account.
  *  this is sample minimal account.
  *  has execute, eth handling methods
  *  has a single signer that can send requests through the entryPoint.
  */
contract SimpleAccountGA is BaseAccount, TokenCallbackHandler, UUPSUpgradeable, Initializable {
    using ECDSA for bytes32;
    
    bytes32 public merkleTreeRoot;
    uint256 public merkleTreeValidity;

    address public owner;

    IEntryPoint private immutable _entryPoint;

    bytes4 private constant FUNCTION_SIGNATURE = bytes4(keccak256("execute2FA(bytes32,bytes32[],address,uint256,bytes)"));

    event SimpleAccountInitialized(IEntryPoint indexed entryPoint, address indexed owner);

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    // TODO: make sure this is not permissionless
    function updateRoot(bytes32 _root, uint256 validity) public {
        _requireFromEntryPointOrOwner();
        require(validity > block.timestamp);
        require(merkleTreeValidity < block.timestamp, "cannot be updated untill previous merke tree expires");
        merkleTreeRoot = _root;
        merkleTreeValidity = validity;
    }

    function verify(bytes32 leaf, bytes32[] memory proof) public view returns (bool) {
        if (merkleTreeValidity < block.timestamp) {
            return true;
        }

        uint128 timestamp = uint128(uint256(leaf) >> 128);
        uint128 low = uint128(uint256(leaf));

        require(timestamp >= block.timestamp - 30 && timestamp <= block.timestamp + 30, "invalid leaf validity");

        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (computedHash < proofElement) {
                // Hash(current computed hash + current element of the proof)
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                // Hash(current element of the proof + current computed hash)
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        // Check if the computed hash (root) is equal to the provided root
        require(computedHash == merkleTreeRoot, "invalid merkle tree");
    }

    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }


    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    function _onlyOwner() internal view {
        //directly from EOA owner, or through the account itself (which gets redirected through execute())
        require(msg.sender == owner || msg.sender == address(this), "only owner");
    }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     */
    function execute(address dest, uint256 value, bytes calldata func) external {
        _requireFromEntryPointOrOwner();
        // we allow to call only execute2FA function
        require(func.length >= 4, "Calldata too short");
        bytes4 functionSelector = bytes4(func[0]) | (bytes4(func[1]) >> 8) | (bytes4(func[2]) >> 16) | (bytes4(func[3]) >> 24);
        require(functionSelector == FUNCTION_SIGNATURE, "Calldata must be for execute2FA");
        _call(dest, value, func);
    }

    function execute2FA(bytes32 leaf, bytes32[] memory proof, address dest, uint256 value, bytes calldata func) public {
        verify(leaf, proof);
        _requireFromEntryPointOrOwnerOrSelf();
        _call(dest, value, func);
    }

    // /**
    //  * execute a sequence of transactions
    //  */
    // function executeBatch(address[] calldata dest, bytes[] calldata func) external {
    //     _requireFromEntryPointOrOwner();
    //     require(dest.length == func.length, "wrong array lengths");
    //     for (uint256 i = 0; i < dest.length; i++) {
    //         _call(dest[i], 0, func[i]);
    //     }
    // }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
      * the implementation by calling `upgradeTo()`
     */
    function initialize(address anOwner) public virtual initializer {
        _initialize(anOwner);
    }

    function _initialize(address anOwner) internal virtual {
        owner = anOwner;
        emit SimpleAccountInitialized(_entryPoint, owner);
    }

    // Require the function call went through EntryPoint or owner
    function _requireFromEntryPointOrOwner() internal view {
        require(msg.sender == address(entryPoint()) || msg.sender == owner, "account: not Owner or EntryPoint");
    }

     function _requireFromEntryPointOrOwnerOrSelf() internal view {
        require(msg.sender == address(entryPoint()) || msg.sender == owner || msg.sender == address(this), "account: not Owner or EntryPoint or self");
    }

    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
    internal override virtual returns (uint256 validationData) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        if (owner != hash.recover(userOp.signature))
            return SIG_VALIDATION_FAILED;
        return 0;
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value : value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /**
     * check current account deposit in the entryPoint
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * deposit more funds for this account in the entryPoint
     */
    function addDeposit() public payable {
        entryPoint().depositTo{value : msg.value}(address(this));
    }

    /**
     * withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) public onlyOwner {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        (newImplementation);
        _onlyOwner();
    }
}

