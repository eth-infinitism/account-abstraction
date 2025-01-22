pragma solidity ^0.8;

import "../interfaces/PackedUserOperation.sol";
import "../core/UserOperationLib.sol";
// SPDX-License-Identifier: MIT

// EIP-7702 code prefix. Also, we use this prefix as a marker in the initCode. To specify this account is EIP-7702.
uint256 constant EIP7702_PREFIX = 0xef0100;

using UserOperationLib for PackedUserOperation;

    //get alternate InitCode (just for hashing) when using EIP-7702
    function _getEip7702InitCodeOverride(PackedUserOperation calldata userOp) view returns (bytes memory) {
        bytes calldata initCode = userOp.initCode;
        if (! _isEip7702InitCode(initCode)) {
            return "";
        }
        address delegate = _getEip7702Delegate(userOp.getSender());
        if (initCode.length < 20)
            return abi.encodePacked(delegate);
        else
            return abi.encodePacked(delegate, initCode[20 :]);
    }


    function _isEip7702InitCode(bytes calldata initCode) pure returns (bool) {
        if (initCode.length < 3) {
            return false;
        }
        uint256 initCodeStart;
        assembly {
            initCodeStart := calldataload(initCode.offset)
        }
        // make sure first 20 bytes of initCode are "0xff0100" (padded with zeros)
        // initCode can be shorter (e.g. only 3), but then it is already zero-padded.
        return (initCodeStart >> (256 - 160)) == ((EIP7702_PREFIX << (160 - 24)));
    }

/**
 * get the EIP-7702 delegate from contract code.
 * requires EXTCODECOPY pr: https://github.com/ethereum/EIPs/pull/9248 (not yet merged or implemented)
 **/
    function _getEip7702Delegate(address sender) view returns (address) {
        uint256 senderCode;
        assembly ("memory-safe") {
            extcodecopy(sender, 0, 0, 32)
            senderCode := mload(0)
        }
        // senderCode is the first 32 bytes of the sender's code
        // If it is an EIP-7702 delegate, then top 24 bits are the EIP7702_PREFIX
        // next 160 bytes are the delegate address
        require(senderCode >> (256 - 24) == EIP7702_PREFIX, "not an EIP-7702 delegate");
        return address(uint160(senderCode >> (256 - 160 - 24)));
    }
