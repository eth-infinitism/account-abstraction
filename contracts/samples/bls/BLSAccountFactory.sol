// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../interfaces/IEntryPoint.sol";
import "./BLSAccount.sol";

/* solhint-disable no-inline-assembly */
/**
 * Based n SimpleAccountFactory
 * can't be a subclass, since both constructor and createAccount depend on the
 * actual wallet contract constructor and initializer
 */
contract BLSAccountFactory {
    BLSAccount public immutable accountImplementation;

    constructor(IEntryPoint entryPoint, address aggregator){
        accountImplementation = new BLSAccount(entryPoint, aggregator);
    }

    /**
     * create an account, and return its address.
     * returns the address even if the account is already deployed.
     * Note that during UserOperation execution, this method is called only if the account is not deployed.
     * This method returns an existing account address so that entryPoint.getSenderAddress() would work even after account creation
     * Also note that our BLSSignatureAggregator requires that the public-key is the last parameter
     */
    function createAccount(uint256 salt, uint256[4] calldata aPublicKey) public returns (BLSAccount) {

        // the BLSSignatureAggregator depends on the public-key being the last 4 uint256 of msg.data.
        uint slot;
        assembly {slot := aPublicKey}
        require(slot == msg.data.length - 128, "wrong pubkey offset");

        address addr = getAddress(salt, aPublicKey);
        uint codeSize = addr.code.length;
        if (codeSize > 0) {
            return BLSAccount(payable(addr));
        }
        return BLSAccount(payable(new ERC1967Proxy{salt : bytes32(salt)}(
                address(accountImplementation),
                abi.encodeCall(BLSAccount.initialize, aPublicKey)
            )));
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by createAccount()
     */
    function getAddress(uint256 salt, uint256[4] memory aPublicKey) public view returns (address) {
        return Create2.computeAddress(bytes32(salt), keccak256(abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(
                    address(accountImplementation),
                    abi.encodeCall(BLSAccount.initialize, (aPublicKey))
                )
            )));
    }
}
