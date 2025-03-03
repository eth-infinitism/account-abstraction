pragma solidity ^0.8;
// SPDX-License-Identifier: MIT
// solhint-disable no-inline-assembly

import "../interfaces/PackedUserOperation.sol";
import "../core/UserOperationLib.sol";

library Eip7702Support {

    // EIP-7702 code prefix before delegate address.
    bytes3 internal constant EIP7702_PREFIX = 0xef0100;

    // EIP-7702 initCode marker, to specify this account is EIP-7702.
    bytes2 internal constant INITCODE_EIP7702_MARKER = 0x7702;

    using UserOperationLib for PackedUserOperation;

    // Get alternate InitCodeHash (just for UserOp hash) when using EIP-7702
    function _getEip7702InitCodeHashOverride(PackedUserOperation calldata userOp) internal view returns (bytes32) {
        bytes calldata initCode = userOp.initCode;
        if (!_isEip7702InitCode(initCode)) {
            return 0;
        }
        address delegate = _getEip7702Delegate(userOp.getSender());
        if (initCode.length <= 20)
            return keccak256(abi.encodePacked(delegate));
        else
            return keccak256(abi.encodePacked(delegate, initCode[20 :]));
    }

    // Check if this initCode is EIP-7702: starts with INITCODE_EIP7702_MARKER.
    function _isEip7702InitCode(bytes calldata initCode) internal pure returns (bool) {

        if (initCode.length < 2) {
            return false;
        }
        bytes20 initCodeStart;
        // non-empty calldata bytes are always zero-padded to 32-bytes, so can be safely casted to "bytes20"
        assembly ("memory-safe") {
            initCodeStart := calldataload(initCode.offset)
        }
        // make sure first 20 bytes of initCode are "0x7702" (padded with zeros)
        return initCodeStart == bytes20(INITCODE_EIP7702_MARKER);
    }

    /**
     * get the EIP-7702 delegate from contract code.
     * must only be used if _isEip7702InitCode(initCode) is true.
     */
    function _getEip7702Delegate(address sender) internal view returns (address) {

        bytes32 senderCode;

        assembly ("memory-safe") {
            extcodecopy(sender, 0, 0, 23)
            senderCode := mload(0)
        }
        // To be a valid EIP-7702 delegate, the first 3 bytes are EIP7702_PREFIX
        // followed by the delegate address
        if (bytes3(senderCode) != EIP7702_PREFIX) {
            // instead of just "not an EIP-7702 delegate", if some info.
            require(sender.code.length > 0, "sender has no code");
            revert("not an EIP-7702 delegate");
        }
        return address(bytes20(senderCode << 24));
    }
}
