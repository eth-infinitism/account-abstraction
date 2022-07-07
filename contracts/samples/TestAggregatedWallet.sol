// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "../IAggregator.sol";
import "../IAggregatedWallet.sol";

/**
 * test aggregated-signature wallet.
 * works only with TestAggregatedSignature, which doesn't really check signature, but nonce sum
 * a true aggregated wallet should expose data (e.g. its public key) to the aggregator.
 */
contract TestAggregatedWallet is IAggregatedWallet {
    address public immutable aggregator;
    address public entryPoint;
    uint public nonce;

    constructor(address anEntryPoint, address anAggregator) {
        entryPoint = address(anEntryPoint);
        aggregator = anAggregator;
    }

    receive() external payable {}

    function validateUserOp(UserOperation calldata userOp, bytes32 requestId, address _aggregator, uint256 missingWalletFunds) external override {
        require(msg.sender == entryPoint, "not from entrypoint");
        require(_aggregator == aggregator, "wrong aggregator");
        require(nonce++ == userOp.nonce, "wrong nonce");
        if (missingWalletFunds > 0) {
            if (missingWalletFunds != 0) {
                (bool success,) = payable(msg.sender).call{value : missingWalletFunds}("");
                (success);
            }
        }
    }

    function getAggregator() external override view returns (address) {
        return aggregator;
    }
}
