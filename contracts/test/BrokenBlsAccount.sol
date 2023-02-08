// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../samples/SimpleAccount.sol";
import "../bls/IBLSAccount.sol";

/**
 * for testing: a BLS account that fails to return its public-key (completely ignores its publickey)
 * this is a copy of the normal bls account, but it returns a public-key unrelated to the one it is constructed with.
 */
contract BrokenBLSAccount is SimpleAccount, IBLSAccount {
    address public immutable aggregator;

    // The constructor is used only for the "implementation" and only sets immutable values.
    // Mutable values slots for proxy accounts are set by the 'initialize' function.
    constructor(IEntryPoint anEntryPoint, address anAggregator) SimpleAccount(anEntryPoint)  {
        aggregator = anAggregator;
    }

    function initialize(uint256[4] memory aPublicKey) public virtual initializer {
        (aPublicKey);
        super._initialize(address(0));
    }

    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash, address userOpAggregator)
    internal override view returns (uint256 sigTimeRange) {

        (userOp, userOpHash);
        require(userOpAggregator == aggregator, "BLSAccount: wrong aggregator");
        return 0;
    }

    function getAggregator() external view returns (address) {
        return aggregator;
    }

    function getBlsPublicKey() external override pure returns (uint256[4] memory) {
        uint256[4] memory pubkey;
        return pubkey;
    }
}


/**
 * Based n SimpleAccountFactory
 * can't be a subclass, since both constructor and createAccount depend on the
 * actual wallet contract constructor and initializer
 */
contract BrokenBLSAccountFactory {
    BrokenBLSAccount public immutable accountImplementation;

    constructor(IEntryPoint entryPoint, address aggregator){
        accountImplementation = new BrokenBLSAccount(entryPoint, aggregator);
    }

    /**
     * create an account, and return its address.
     * returns the address even if the account is already deployed.
     * Note that during UserOperation execution, this method is called only if the account is not deployed.
     * This method returns an existing account address so that entryPoint.getSenderAddress() would work even after account creation
     * Also note that out BLSSignatureAggregator requires that the public-key is the last parameter
     */
    function createAccount(uint salt, uint256[4] memory aPublicKey) public returns (BrokenBLSAccount) {

        address addr = getAddress(salt, aPublicKey);
        uint codeSize = addr.code.length;
        if (codeSize > 0) {
            return BrokenBLSAccount(payable(addr));
        }
        return BrokenBLSAccount(payable(new ERC1967Proxy{salt : bytes32(salt)}(
                address(accountImplementation),
                abi.encodeCall(BrokenBLSAccount.initialize, aPublicKey)
            )));
    }

    /**
     * calculate the counterfactual address of this account as it would be returned by createAccount()
     */
    function getAddress(uint salt, uint256[4] memory aPublicKey) public view returns (address) {
        return Create2.computeAddress(bytes32(salt), keccak256(abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(
                    address(accountImplementation),
                    abi.encodeCall(BrokenBLSAccount.initialize, (aPublicKey))
                )
            )));
    }
}
