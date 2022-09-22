//SPDX-License-Identifier: GPL
pragma solidity ^0.8.7;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@gnosis.pm/safe-contracts/contracts/GnosisSafe.sol";
import "./EIP4337Fallback.sol";
import "../core/EntryPoint.sol";

    using ECDSA for bytes32;

/**
 * Main EIP4337 module.
 * Called (through the fallback module) using "delegate" from the GnosisSafe as an "IWallet",
 * so must implement validateUserOp
 * holds an immutable reference to the EntryPoint
 * Inherits GnosisSafeStorage so that it can reference the memory storage
 */
contract EIP4337Manager is GnosisSafe, IWallet {

    address public immutable eip4337Fallback;
    address public immutable entryPoint;

    constructor(address anEntryPoint) {
        entryPoint = anEntryPoint;
        eip4337Fallback = address(new EIP4337Fallback(address(this)));
    }

    /**
     * delegate-called (using execFromModule) through the fallback, so "real" msg.sender is attached as last 20 bytes
     */
    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, address /*aggregator*/, uint256 missingWalletFunds) external override {
        address _msgSender = address(bytes20(msg.data[msg.data.length - 20 :]));
        require(_msgSender == entryPoint, "wallet: not from entrypoint");

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
        EIP4337Manager manager,
        address owner
    ) external {
        address eip4337fallback = manager.eip4337Fallback();

        address[] memory owners = new address[](1);
        owners[0] = owner;
        uint threshold = 1;

        execute(singleton, 0, abi.encodeCall(GnosisSafe.setup, (
            owners, threshold,
            address(0), "", //no delegate call
            eip4337fallback,
            address(0), 0, payable(0) //no payment receiver
            )),
            Enum.Operation.DelegateCall, gasleft()
        );

        _enableModule(manager.entryPoint());
        _enableModule(eip4337fallback);
    }

    /**
     * replace EIP4337 module, to support a new EntryPoint.
     * must be called using execTransaction and Enum.Operation.DelegateCall
     * @param prevModule returned by getCurrentEIP4337Manager
     * @param oldManager the old EIP4337 manager to remove, returned by getCurrentEIP4337Manager
     * @param newManager the new EIP4337Manager, usually with a new EntryPoint
     */
    function replaceEIP4337Manager(address prevModule, EIP4337Manager oldManager, EIP4337Manager newManager) public {

        GnosisSafe pThis = GnosisSafe(payable(address(this)));
        address oldFallback = oldManager.eip4337Fallback();
        require(pThis.isModuleEnabled(oldFallback), "replaceEIP4337Manager: oldManager is not active");
        pThis.disableModule(oldFallback, oldManager.entryPoint());
        pThis.disableModule(prevModule, oldFallback);

        address eip4337fallback = newManager.eip4337Fallback();

        pThis.enableModule(newManager.entryPoint());
        pThis.enableModule(eip4337fallback);

        pThis.setFallbackHandler(eip4337fallback);

        validateEip4337(pThis, newManager);
    }

    /**
     * Validate this gnosisSafe is callable through the EntryPoint.
     * the test is might be incomplete: we check that we reach our validateUserOp and fail on signature.
     *  we don't test full transaction
     */
    function validateEip4337(GnosisSafe safe, EIP4337Manager manager) public {

        // this prevent mistaken replaceEIP4337Manager to disable the module completely.
        // minimal signature that pass "recover"
        bytes memory sig = new bytes(65);
        sig[64] = bytes1(uint8(27));
        sig[2] = bytes1(uint8(1));
        sig[35] = bytes1(uint8(1));
        UserOperation memory userOp = UserOperation(address(safe), 0, "", "", 0, 1000000, 0, 0, 0, "", sig);
        UserOperation[] memory userOps = new UserOperation[](1);
        userOps[0] = userOp;
        IEntryPoint _entryPoint = IEntryPoint(payable(manager.entryPoint()));
        try _entryPoint.handleOps(userOps, payable(msg.sender)) {
            revert("validateEip4337: handleOps must fail");
        } catch (bytes memory error) {
            if (keccak256(error) != keccak256(abi.encodeWithSignature("FailedOp(uint256,address,string)", 0, address(0), "wallet: wrong signature"))) {
                revert(string(error));
            }
        }
    }

    function delegateCall(address to, bytes memory data) internal {
        bool success;
        assembly {
            success := delegatecall(sub(0, 1), to, add(data, 0x20), mload(data), 0, 0)
        }
        require(success, "delegate failed");
    }

    /// copied from GnosisSafe ModuleManager, FallbackManager
    /// enableModule is "external authorizeOnly", can't be used during construction using a "delegatecall"

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

    /**
     * enumerate modules, and find the currently active EIP4337 manager (and previous module)
     * @return prev prev module, needed by replaceEIP4337Manager
     * @return manager the current active EIP4337Manager
     */
    function getCurrentEIP4337Manager(GnosisSafe safe) public view returns (address prev, address manager) {

        prev = address(SENTINEL_MODULES);
        (address[] memory modules,) = safe.getModulesPaginated(SENTINEL_MODULES, 100);
        for (uint i = 0; i < modules.length; i++) {
            address module = modules[i];
            (bool success,bytes memory ret) = module.staticcall(abi.encodeWithSignature("eip4337manager()"));
            if (success) {
                manager = abi.decode(ret, (address));
                return (prev, manager);
            }
            prev = module;
        }
        return (address(0), address(0));
    }
}
