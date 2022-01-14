// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./SimpleWalletForTokens.sol";
import "hardhat/console.sol";
import "../BasePaymaster.sol";

/**
 * A sample paymaster that define itself as a  token to pay for gas.
 * The paymaster IS the token to use, since a paymaster cannot use an external contract.
 * also, the exchange rate has to be fixed, since it can't refernce external Uniswap os other exchange contract.
 */
contract TokenPaymaster is BasePaymaster, ERC20 {

    //calculated cost of the postOp
    uint COST_OF_POST = 3000;

    bytes32 immutable knownWallet;

    constructor(string memory _symbol, EntryPoint _entryPoint) ERC20(_symbol, _symbol) BasePaymaster(_entryPoint) {
        knownWallet = keccak256(type(SimpleWallet).creationCode);
        //        knownWallets[keccak256(type(SimpleWallet).creationCode)] = true;
        approve(owner(), type(uint).max);
    }

    //helpers for owner, to mint and withdraw tokens.
    function mintTokens(address recipient, uint amount) external onlyOwner {
        _mint(recipient, amount);
    }

    //TODO: this method assumes a fixed ratio of token-to-eth. should use oracle.
    function ethToToken(uint valueEth) internal pure returns (uint valueToken) {
        return valueEth / 100;
    }

    // verify that the user has enough tokens.
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*requestId*/, uint requiredPreFund) external view override returns (bytes memory context) {
        uint tokenPrefund = ethToToken(requiredPreFund);

        if (userOp.initCode.length != 0) {
            bytes32 bytecodeHash = keccak256(userOp.initCode[0 : userOp.initCode.length - 64]);
            require(knownWallet == bytecodeHash, "TokenPaymaster: unknown wallet constructor");

            //verify the token constructor params:
            // first param (of 2) should be our entryPoint
            bytes32 entryPointParam = bytes32(userOp.initCode[userOp.initCode.length - 64 :]);
            require(address(uint160(uint256(entryPointParam))) == address(entryPoint), "wrong paymaster in constructor");

            //TODO: must also whitelist init function (callData), since that what will call "token.approve(paymaster)"
            //no "allowance" check during creation (we trust known constructor/init function)
            require(balanceOf(userOp.sender) > tokenPrefund, "TokenPaymaster: no balance (pre-create)");
        } else {

            require(balanceOf(userOp.sender) > tokenPrefund, "TokenPaymaster: no balance");
        }

        //since we ARE the token, we don't need approval to _transfer() value from user's balance.
        //        if (token.allowance(userOp.sender, address(this)) < tokenPrefund) {
        //
        //            //TODO: allowance too low. just before reverting, can check if current operation is "token.approve(paymaster)"
        //            // this is a multi-step operation: first, verify "callData" is exec(token, innerData)
        //            //     (this requires knowing the "execute" signature of the wallet
        //            // then verify that "innerData" is approve(paymaster,-1)
        //            revert("TokenPaymaster: no allowance");
        //        }
        return abi.encode(userOp.sender);
    }

    //actual charge of user.
    // this method will be called just after the user's TX with postRevert=false.
    // BUT: if the user changed its balance and that postOp reverted, then it gets called again, after reverting
    // the user's TX
    function _postOp(PostOpMode mode, bytes calldata context, uint actualGasCost) internal override {
        //we don't really care about the mode, we just pay the gas with the user's tokens.
        (mode);
        address sender = abi.decode(context, (address));
        uint charge = ethToToken(actualGasCost + COST_OF_POST);
        //actualGasCost is known to be no larger than the above requiredPreFund, so the transfer should succeed.
        _transfer(sender, address(this), charge);
    }
}
