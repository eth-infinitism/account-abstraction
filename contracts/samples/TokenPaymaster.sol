// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../IPaymaster.sol";
import "../Singleton.sol";
import "./SimpleWalletForTokens.sol";
import "hardhat/console.sol";

/**
 * A sample paymaster that define itself as a  token to pay for gas.
 * The paymaster IS the token to use, since a paymaster cannot use an external contract.
 * also, the exchange rate has to be fixed, since it can't refernce external Uniswap os other exchange contract.
 */
contract TokenPaymaster is Ownable, ERC20, IPaymaster {

    //calculated cost of the postOp
    uint COST_OF_POST = 3000;

    Singleton singleton;
    bytes32 immutable knownWallet;

    constructor(string memory _symbol, Singleton _singleton) ERC20(_symbol, _symbol) {
        singleton = _singleton;
        knownWallet = keccak256(type(SimpleWallet).creationCode);
//        knownWallets[keccak256(type(SimpleWallet).creationCode)] = true;
        approve(owner(), type(uint).max);
    }

    //helpers for owner, to mint and withdraw tokens.
    function mintTokens(address recipient, uint amount) external onlyOwner {
        _mint(recipient, amount);
    }

    //owner should call and put eth into it.
    function addStake() external payable {
        singleton.addStake{value : msg.value}();
    }

    //TODO: this method assumes a fixed ratio of token-to-eth. should use oracle.
    function ethToToken(uint valueEth) internal pure returns (uint valueToken) {
        return valueEth / 100;
    }

    // verify that the user has enough tokens.
    function payForOp(UserOperation calldata userOp, uint requiredPreFund) external view override returns (bytes memory context) {
        uint tokenPrefund = ethToToken(requiredPreFund);

        if (userOp.initCode.length != 0) {
            bytes32 bytecodeHash = keccak256(userOp.initCode[0:userOp.initCode.length-64]);
            require(knownWallet == bytecodeHash, "TokenPaymaster: unknown wallet constructor");

            //verify the token constructor params:
            // first param (of 2) should be our singleton
            bytes32 singletonParam = bytes32(userOp.initCode[userOp.initCode.length-64:]);
            require( address(uint160(uint256(singletonParam))) == address(singleton), "wrong paymaster in constructor");

            //TODO: must also whitelist init function (callData), since that what will call "token.approve(paymaster)"
            //no "allowance" check during creation (we trust known constructor/init function)
            require(balanceOf(userOp.target) > tokenPrefund, "TokenPaymaster: no balance (pre-create)");
        } else {

            require(balanceOf(userOp.target) > tokenPrefund, "TokenPaymaster: no balance");
        }

        //since we ARE the token, we don't need approval to _transfer() value from user's balance.
        //        if (token.allowance(userOp.target, address(this)) < tokenPrefund) {
        //
        //            //TODO: allowance too low. just before reverting, can check if current operation is "token.approve(paymaster)"
        //            // this is a multi-step operation: first, verify "callData" is exec(token, innerData)
        //            //     (this requires knowing the "execute" signature of the wallet
        //            // then verify that "innerData" is approve(paymaster,-1)
        //            revert("TokenPaymaster: no allowance");
        //        }
        return abi.encode(userOp.target);
    }

    //actual charge of user.
    // this method will be called just after the user's TX with postRevert=false.
    // BUT: if the user changed its balance and that postOp reverted, then it gets called again, after reverting
    // the user's TX
    function postOp(PostOpMode mode, bytes calldata context, uint actualGasCost) external override {
        //we don't really care about the mode, we just pay the gas with the user's tokens.
        (mode);
        address target = abi.decode(context, (address));
        uint charge = ethToToken(actualGasCost + COST_OF_POST);
        //actualGasCost is known to be no larger than the above requiredPreFund, so the transfer should succeed.
        _transfer(target, address(this), charge);
    }
}
