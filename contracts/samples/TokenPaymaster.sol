// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable reason-string */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./SimpleWallet.sol";
import "../BasePaymaster.sol";

/**
 * A sample paymaster that define itself as a token to pay for gas.
 * The paymaster IS the token to use, since a paymaster cannot use an external contract.
 * Also, the exchange rate has to be fixed, since it can't reference an external Uniswap or other exchange contract.
 * subclass should override "getTokenValueOfEth to provide actual token exchange rate, settable by the owner.
 * Known Limitation: this paymaster is exploitable when put into a batch with multiple ops (of different wallets):
 * - while a single op can't exploit the paymaster (if postOp fails to withdraw the tokens, the user's op is reverted,
 *   and then we know we can withdraw the tokens), multiple ops with different senders (all using this paymaster)
 *   in a batch can withdraw funds from 2nd and further ops, forcing the paymaster itself to pay (from its deposit)
 * - Possible workarounds are either use a more complex paymaster scheme (e.g. the DepositPaymaster) or
 *   to whitelist the wallet and the called method ids.
 */
contract TokenPaymaster is BasePaymaster, ERC20 {

    //calculated cost of the postOp
    uint256 constant public COST_OF_POST = 15000;

    address public theDeployer;

    constructor(address walletDeployer, string memory _symbol, EntryPoint _entryPoint) ERC20(_symbol, _symbol) BasePaymaster(_entryPoint) {
        theDeployer = walletDeployer;
        //make it non-empty
        _mint(address(this), 1);

        //owner is allowed to withdraw tokens from the paymaster's balance
        _approve(address(this), msg.sender, type(uint).max);
    }

    //helpers for owner, to mint and withdraw tokens.
    function mintTokens(address recipient, uint256 amount) external onlyOwner {
        _mint(recipient, amount);
    }

    /**
     * transfer paymaster ownership.
     * owner of this paymaster is allowed to withdraw funds (tokens transferred to this paymaster's balance)
     * when changing owner, the old owner's withdrawal rights are revoked.
     */
    function transferOwnership(address newOwner) public override virtual onlyOwner {
        // remove allowance of current owner
        _approve(address(this), owner(), 0);
        super.transferOwnership(newOwner);
        // new owner is allowed to withdraw tokens from the paymaster's balance
        _approve(address(this), newOwner, type(uint).max);
    }

    //TODO: this method assumes a fixed ratio of token-to-eth. subclass should override to supply oracle
    // or a setter.
    function getTokenValueOfEth(uint256 valueEth) internal view virtual returns (uint256 valueToken) {
        return valueEth / 100;
    }

    /**
      * validate the request:
      * if this is a constructor call, make sure it is a known wallet (that is, a contract that
      * we trust that in its constructor will set
      * verify the sender has enough tokens.
      * (since the paymaster is also the token, there is no notion of "approval")
      */
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*requestId*/, uint256 requiredPreFund)
    external view override returns (bytes memory context) {
        uint256 tokenPrefund = getTokenValueOfEth(requiredPreFund);

        // verificationGas is dual-purposed, as gas limit for postOp. make sure it is high enough
        // make sure that verificationGas is high enough to handle postOp
        require(userOp.verificationGas > COST_OF_POST, "TokenPaymaster: gas too low for postOp");

        if (userOp.initCode.length != 0) {
            _validateConstructor(userOp);
            require(balanceOf(userOp.sender) >= tokenPrefund, "TokenPaymaster: no balance (pre-create)");
        } else {

            require(balanceOf(userOp.sender) >= tokenPrefund, "TokenPaymaster: no balance");
        }

        return abi.encode(userOp.sender);
    }

    // when constructing a wallet, validate constructor code and parameters
    // this code highly dependent on the deployer we use.
    // our deployer has a method deploy(bytes,salt)
    function _validateConstructor(UserOperation calldata userOp) internal virtual view {
        //we trust a specific deployer contract
        address deployer = address(bytes20(userOp.initCode[0:20]));
        require(deployer == theDeployer, "TokenPaymaster: wrong wallet deployer");
    }

    /**
     * actual charge of user.
     * this method will be called just after the user's TX with mode==OpSucceeded|OpReverted (wallet pays in both cases)
     * BUT: if the user changed its balance in a way that will cause  postOp to revert, then it gets called again, after reverting
     * the user's TX , back to the state it was before the transaction started (before the validatePaymasterUserOp),
     * and the transaction should succeed there.
     */
    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) internal override {
        //we don't really care about the mode, we just pay the gas with the user's tokens.
        (mode);
        address sender = abi.decode(context, (address));
        uint256 charge = getTokenValueOfEth(actualGasCost + COST_OF_POST);
        //actualGasCost is known to be no larger than the above requiredPreFund, so the transfer should succeed.
        _transfer(sender, address(this), charge);
    }
}
