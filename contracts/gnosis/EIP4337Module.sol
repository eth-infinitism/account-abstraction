//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "./EIP4337Fallback.sol";
import "../BaseWallet.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./GnosisSafeStorage.sol";

    using ECDSA for bytes32;


/**
 * Main EIP4337 module.
 * Called (through the fallback module) using "delegate" from the GnosisSafe as an "IWallet",
 * so must implement validateUserOp
 * holds an immutable reference to the EntryPoint
 * Inherits GnosisSafeStorage so that it can reference the memory storage
 */
contract EIP4337Module is IWallet, GnosisSafeStorage, BaseWallet {

    EIP4337Fallback public immutable eip4337Fallback;
    EntryPoint immutable _entryPoint;

    constructor(EntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        eip4337Fallback = new EIP4337Fallback(address(anEntryPoint), address(this));
    }

    function nonce() public view virtual override returns (uint256) {
        return __nonce;
    }

    function entryPoint() public view virtual override returns (EntryPoint) {
        return _entryPoint;
    }

    //not needed: we are callable from modules, and we add "entrypoint" as module.
    function _requireFromEntryPoint() internal virtual override view {
    }


    function _validateSignature(UserOperation calldata userOp, bytes32 requestId) internal view override {
        GnosisSafe pThis = GnosisSafe(payable(address(this)));
        bytes32 hash = requestId.toEthSignedMessageHash();
        address recovered = hash.recover(userOp.signature);
        require(__threshold == 1, "wallet: only threshold 1");
        require(pThis.isOwner(recovered), "wallet: wrong signature");
    }

    /// implement template method of BaseWallet
    function _validateAndUpdateNonce(UserOperation calldata userOp) internal override {
        require(__nonce++ == userOp.nonce, "wallet: invalid nonce");
    }

    function _payPrefund(uint256 missingWalletFunds) internal virtual override {
        //pay for 4 TXs like this, to save on paying prefund on each call.
        // (not required, but save gas on multiple requests)
        super._payPrefund(missingWalletFunds * 4);
    }

    /**
     * set up a safe as EIP-4337 enabled.
     * called from the GnosisSafeProxy4337 during construction time
     * - enable 3 modules (this module, fallback and the entrypoint)
     * - this method is called with delegateCall, so the module (usually itself) is passed as parameter, and "this" is the safe itself
     */
    function setupEIP4337(
        address singleton,
        EIP4337Module module,
        address owner
    ) external {
        address fallbackHandler = address(module.eip4337Fallback());

        address[] memory owners = new address[](1);
        owners[0] = owner;
        uint threshold = 1;

        delegateCall(singleton, abi.encodeCall(GnosisSafe.setup, (
            owners, threshold,
            address(0), "", //no delegate call
            fallbackHandler,
            address(0), 0, payable(0) //no payment receiver
            ))
        );

        _setNewModule(module);
    }

    /**
     * replace EIP4337 module, to support a new EntryPoint.
     * must be called using Enum.Operation.DelegateCall
     * @param prevModule Module that pointed to the module to be removed in the linked list
     * @param oldModule the old EIP4337 module to remove.
     * @param newModule the new EIP4337Module, usually with a new EntryPoint
     */
    function replaceEIP4337Module(address prevModule, EIP4337Module oldModule, EIP4337Module newModule) public {

        GnosisSafe pThis = GnosisSafe(payable(address(this)));
        require(!pThis.isModuleEnabled(address(newModule)), "replaceEIP4337Module: newModule already enabled");

        require(pThis.isModuleEnabled(address(oldModule)), "replaceEIP4337Module: oldModule not enabled");
        pThis.disableModule(address(oldModule.eip4337Fallback()), address(oldModule.entryPoint()));
        pThis.disableModule(address(oldModule), address(oldModule.eip4337Fallback()));
        pThis.disableModule(prevModule, address(oldModule));

        address eip4337fallback = address(newModule.eip4337Fallback());
        pThis.enableModule(address(newModule));
        pThis.enableModule(eip4337fallback);
        pThis.enableModule(address(newModule.entryPoint()));
        internalSetFallbackHandler(eip4337fallback);

        validateEip4337(pThis, newModule);
    }

    /**
     * enable the eip4337 module on this safe.
     * called as a delegatecall - so "this" is a safe, and the module address is a parameter.
     */
    function _setNewModule(EIP4337Module newModule) private {
        address eip4337fallback = address(newModule.eip4337Fallback());
        _enableModule(address(newModule));
        _enableModule(eip4337fallback);
        _enableModule(address(newModule.entryPoint()));
    }

    //can't change directly the entrypoint: need to change the EIP4337Module
    // (together with the related fallback handler)
    function _updateEntryPoint(address) internal virtual override {
        revert("use EIP4337Module.setEntryPoint");
    }

    error FailedOp(uint256 opIndex, address paymaster, string reason);
    /**
     * Validate this gnosisSafe is callable through the EntryPoint.
     * the test is INCOMPLETE: we check that we reach our validateUserOp, which will fail, and we can't get the reason...
     */
    function validateEip4337(GnosisSafe safe, EIP4337Module module) public {

        //TODO: make a call to validate the new entrypoint is valid
        // this prevent mistaken replaceModule to disable the module completely.
        bytes memory sig = new bytes(65);
        sig[64] = bytes1(uint8(27));
        sig[2] = bytes1(uint8(1));
        sig[35] = bytes1(uint8(1));
        UserOperation memory userOp = UserOperation(address(safe), 0, "", "", 0, 1000000, 0, 0, 0, address(0), "", sig);
        UserOperation[] memory userOps = new UserOperation[](1);
        userOps[0] = userOp;
        try module.entryPoint().handleOps(userOps, payable(msg.sender)) {
            revert("validateEip4337: handleOps must fail");
        } catch (bytes memory error) {
            if (keccak256(error) != keccak256(abi.encodeWithSignature("FailedOp(uint256,address,string)", 0, address(0), "wallet: wrong signature"))) {
                revert(string(error));
            }
        }
    }

    function delegateCall(address to, bytes memory data) internal {
        bool success;
        //        require(to != address(0), "why calling zero");
        assembly {
            success := delegatecall(sub(0, 1), to, add(data, 0x20), mload(data), 0, 0)
        }
        require(success, "delegate failed");
    }

    /// copied from GnosisSafe ModuleManager, FallbackManager
    /// setFallbackHandler is internal, so we must copy it
    /// enableModule is external, but can't be used during construction

    // keccak256("fallback_manager.handler.address")
    bytes32 internal constant FALLBACK_HANDLER_STORAGE_SLOT = 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;

    function internalSetFallbackHandler(address handler) internal {
        bytes32 slot = FALLBACK_HANDLER_STORAGE_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, handler)
        }
    }

    address internal constant SENTINEL_MODULES = address(0x1);
    /// @dev Allows to add a module to the whitelist.
    ///      This can only be done via a Safe transaction.
    /// @notice Enables the module `module` for the Safe.
    /// @param module Module to be whitelisted.
    function _enableModule(address module) internal {

        // Module address cannot be null or sentinel.
        require(module != address(0) && module != SENTINEL_MODULES, "GS101");
        // Module cannot be added twice.
        require(__modules[module] == address(0), "GS102");

        __modules[module] = __modules[SENTINEL_MODULES];

        __modules[SENTINEL_MODULES] = module;
        //        emit EnabledModule(module);
    }

    //enumerate modules, and find the currently active EIP4337 module (and previous module)
    function getEnabledModule(GnosisSafe safe) public view returns (address prev, address module) {

        prev = address(0);
        (address[] memory modules,) = safe.getModulesPaginated(SENTINEL_MODULES, 100);
        for (uint i = 0; i < modules.length; i++) {
            module = modules[i];
            (bool success,) = module.staticcall(abi.encodeWithSignature("entryPoint()"));
            if (success) {
                return (prev, module);
            }
            prev = module;
        }
        return (address(0), address(0));
    }
}
