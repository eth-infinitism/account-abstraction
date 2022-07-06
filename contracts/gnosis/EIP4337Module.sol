//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "./EIP4337Fallback.sol";
import "../EntryPoint.sol";

    using ECDSA for bytes32;

/**
 * Main EIP4337 module.
 * Called (through the fallback module) using "delegate" from the GnosisSafe as an "IWallet",
 * so must implement validateUserOp
 * holds an immutable reference to the EntryPoint
 * Inherits GnosisSafeStorage so that it can reference the memory storage
 */
contract EIP4337Module is GnosisSafe, IWallet {

    EIP4337Fallback public immutable eip4337Fallback;
    EntryPoint public immutable entryPoint;

    constructor(EntryPoint anEntryPoint) {
        entryPoint = anEntryPoint;
        eip4337Fallback = new EIP4337Fallback(address(this));
    }

    /**
     * delegate-called (using execFromModule) through the fallback, so "real" msg.sender is attached as last 20 bytes
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, uint256 missingWalletFunds) external override {
        address _msgSender = address(bytes20(msg.data[msg.data.length - 20 :]));
        require(_msgSender == address(entryPoint), "wallet: not from entrypoint");

        GnosisSafe pThis = GnosisSafe(payable(address(this)));
        bytes32 hash = requestId.toEthSignedMessageHash();
        address recovered = hash.recover(userOp.signature);
        require(threshold == 1, "wallet: only threshold 1");
        require(pThis.isOwner(recovered), "wallet: wrong signature");

        if (userOp.initCode.length == 0) {
            require(nonce++ == userOp.nonce, "wallet: invalid nonce");
        }

        if (missingWalletFunds > 0) {
            //TODO: MAY pay more than the minimum, to deposit for future transactions
            (bool success,) = payable(_msgSender).call{value : missingWalletFunds}("");
            (success);
            //ignore failure (its EntryPoint's job to verify, not wallet.)
        }
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
        _internalSetFallbackHandler(eip4337fallback);

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

    /**
     * Validate this gnosisSafe is callable through the EntryPoint.
     * the test is INCOMPLETE: we check that we reach our validateUserOp, which will fail, and we can't get the reason...
     */
    function validateEip4337(GnosisSafe safe, EIP4337Module module) public {

        //TODO: make a call to validate the new entrypoint is valid
        // this prevent mistaken replaceModule to disable the module completely.
        //minimal signature that pass "recover"
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
    //    bytes32 internal constant FALLBACK_HANDLER_STORAGE_SLOT = 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5;

    function _internalSetFallbackHandler(address handler) internal {
        bytes32 slot = FALLBACK_HANDLER_STORAGE_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, handler)
        }
    }

    /// @dev Allows to add a module to the whitelist.
    ///      this is a variant of enableModule that is used only during construction
    /// @notice Enables the module `module` for the Safe.
    /// @param module Module to be whitelisted.
    function _enableModule(address module) private {

        // Module address cannot be null or sentinel.
        require(module != address(0) && module != SENTINEL_MODULES, "GS101");
        // Module cannot be added twice.
        require(modules[module] == address(0), "GS102");
        modules[module] = modules[SENTINEL_MODULES];
        modules[SENTINEL_MODULES] = module;
        emit EnabledModule(module);
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
