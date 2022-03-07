// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./SimpleWallet.sol";
import "../BasePaymaster.sol";
/**
 * A sample paymaster that define itself as a token to pay for gas.
 * The paymaster IS the token to use, since a paymaster cannot use an external contract.
 * Also, the exchange rate has to be fixed, since it can't reference an external Uniswap os other exchange contract.
 * subclass should override "getTokenToEthOutputPrice to provide actual token exchange rate, settable by the owner.
 * Known Limitation: this paymaster is exploitable when put into a batch with multiple ops (of different wallets):
 * - while a single op can't exploit the paymaster (if postOp fails to withdraw the tokens, the user's op is reverted,
 *   and then we know we can withdraw the tokens), multiple ops with different senders (all using this paymaster)
 *   in a batch can withdraw funds from 2nd and further ops, forcing the paymaster itself to pay (from its stake)
 * - Possible workarounds are either use a more complex paymaster scheme (e.g. the DepositPaymaster) or
 *   to whitelist the wallet and the called method-ids.
 */
contract TokenPaymaster is BasePaymaster, ERC20 {

    //calculated cost of the postOp
    uint256 constant COST_OF_POST = 15000;

    bytes32 immutable public knownWallet;

    constructor(string memory _symbol, EntryPoint _entryPoint) ERC20(_symbol, _symbol) BasePaymaster(_entryPoint) {
        knownWallet = _knownWallet();
        //make it non-empty
        _mint(address(this), 1);
        _approve(address(this), msg.sender, type(uint).max);
    }

    // known wallet construct we support the creation of.
    function _knownWallet() internal view virtual returns (bytes32) {
        return keccak256(type(SimpleWallet).creationCode);
    }

    //helpers for owner, to mint and withdraw tokens.
    function mintTokens(address recipient, uint256 amount) external onlyOwner {
        _mint(recipient, amount);
    }

    function transferOwnership(address newOwner) public override virtual onlyOwner {
        //remove allowanec of current owner
        _approve(address(this), owner(), 0);
        super.transferOwnership(newOwner);
        //set infinite allowance for new owner
        _approve(address(this), newOwner, type(uint).max);
    }

    //TODO: this method assumes a fixed ratio of token-to-eth. subclass should override to supply oracle
    // or a setter.
    function getTokenToEthOutputPrice(uint256 valueEth) internal view virtual returns (uint256 valueToken) {
        return valueEth / 100;
    }

    // verify that the user has enough tokens.
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 /*requestId*/, uint256 requiredPreFund)
    external view override returns (bytes memory context) {
        uint256 tokenPrefund = getTokenToEthOutputPrice(requiredPreFund);

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
    function _validateConstructor(UserOperation calldata userOp) internal virtual view {
        bytes32 bytecodeHash = keccak256(userOp.initCode[0 : userOp.initCode.length - 64]);
        require(knownWallet == bytecodeHash, "TokenPaymaster: unknown wallet constructor");

        //verify the token constructor params:
        // first param (of 2) should be our entryPoint
        bytes32 entryPointParam = bytes32(userOp.initCode[userOp.initCode.length - 64 :]);
        require(address(uint160(uint256(entryPointParam))) == address(entryPoint), "wrong paymaster in constructor");

        //the 2nd parameter is the owner, but we don't need to validate it (it is done in validateUserOp)
    }

    //actual charge of user.
    // this method will be called just after the user's TX with mode==OpSucceeded|OpReverted.
    // BUT: if the user changed its balance in a way that will cause  postOp to revert, then it gets called again, after reverting
    // the user's TX
    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) internal override {
        //we don't really care about the mode, we just pay the gas with the user's tokens.
        (mode);
        address sender = abi.decode(context, (address));
        uint256 charge = getTokenToEthOutputPrice(actualGasCost + COST_OF_POST);
        //actualGasCost is known to be no larger than the above requiredPreFund, so the transfer should succeed.
        _transfer(sender, address(this), charge);
    }
}
