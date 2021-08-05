// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IPaymaster.sol";
import "./Singleton.sol";

/**
 * A sample paymaster that uses the user's token to pay for gas.
 * NOTE: actual paymaster should use some price oracle, and might also attempt to swap tokens for ETH.
 * for simplicity, this contract uses hard-coded token price, and assumes its owner should provide it with enough
 * eth (and collect the accumulated tokens)
 */
contract TokenPaymaster is Ownable, IPaymaster {

    //calculated cost of the postOp
    uint COST_OF_POST = 3000;

    IERC20 token;
    Singleton singleton;

    constructor(Singleton _singleton, IERC20 _token) {
        singleton = _singleton;
        token  = _token;
    }

    //after successful transactions, this paymaster accumulates tokens.
    function withdrawTokens(address withdrawAddress, uint amount) external onlyOwner {
        token.transfer(withdrawAddress, amount);
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
    function payForOp(UserOperation calldata userOp) external view override returns (bytes32 context) {
        uint tokenPrefund = ethToToken(UserOperationLib.requiredPreFund(userOp));
        require(token.allowance(userOp.signer, address(this))>=tokenPrefund, "not enough allowance");
        require(token.balanceOf(userOp.signer) > tokenPrefund, "not enough balance");
        return bytes32(uint(1)); //we do need the postOp
    }

    //actual charge of user.
    // this method will be called just after the user's TX with postRevert=false.
    // BUT: if the user changed its balance and that postOp reverted, then it gets called again, after reverting
    // the user's TX
    function postOp(PostOpMode mode, UserOperation calldata userOp, bytes32 context, uint actualGasCost) external override {
        //we don't really care about the mode, we just pay the gas with the user's tokens.
        (mode,context);
        uint charge = ethToToken(actualGasCost + COST_OF_POST);
        //actualGasCost is known to be no larger than the above requiredPreFund, so the transfer should succeed.
        token.transferFrom(userOp.signer, address(this), charge);
    }
}
