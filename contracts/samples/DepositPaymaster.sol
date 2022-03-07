// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "../BasePaymaster.sol";
import "./IOracle.sol";

/**
 * A token-based paymaster that accepts token deposit
 * The deposit is only a safeguard: the user pays with his token balance.
 *  only if the user didn't approve() the paymaster, or if the token balance is not enough, the deposit will be used.
 *  thus the required deposit is to cover just one method call.
 * The deposit is locked for the current block: the user must issue unlockTokenDeposit() to be allowed to withdraw
 *  (but can't use the deposit for this or further operations)
 *
 * paymasterData should hold the token to use.
 * @notice This paymaster will be rejected by the standard rules of EIP4337, as it uses an external oracle.
 * (the standard rules ban accessing data of an external contract)
 * It can only be used if it is "whitelisted" by the bundler.
 * (technically, it can be used by an "oracle" which returns a static value, without accessing any storage)
 */
contract DepositPaymaster is BasePaymaster {

    using UserOperationLib for UserOperation;
    using SafeERC20 for IERC20;

    //calculated cost of the postOp
    uint256 constant COST_OF_POST = 35000;

    IOracle private constant nullOracle = IOracle(address(0));
    mapping(IERC20 => IOracle) public oracles;
    mapping(IERC20 => mapping(address => uint256)) public balances;
    mapping(address => uint256) public unlockBlock;

    constructor(EntryPoint _entryPoint) BasePaymaster(_entryPoint) {
        //owner account is unblocked, to allow withdraw of paid tokens;
        unlockTokenDeposit();
    }

    /**
     * owner of the paymaster should add supported tokens
     */
    function addToken(IERC20 token, IOracle tokenPriceOracle) external onlyOwner {
        require(oracles[token] == nullOracle);
        oracles[token] = tokenPriceOracle;
    }

    /**
     * deposit tokens that a specific account can use to pay for gas.
     * The sender must first approve this paymaster to withdraw these tokens (they are only withdrawn in this method).
     * Note depositing the tokens is equivalent to transferring them to the "account" - only the account can later
     *  use them - either as gas, or using withdrawTo()
     *
     * @param token the token to deposit.
     * @param account the account to deposit for.
     * @param amount the amount of token to deposit.
     */
    function addDepositFor(IERC20 token, address account, uint256 amount) external {
        //(sender must have approval for the paymaster)
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(oracles[token] != nullOracle, "unsupported token");
        balances[token][account] += amount;
        if (msg.sender == account) {
            lockTokenDeposit();
        }
    }

    function depositInfo(IERC20 token, address account) public view returns (uint256 amount, uint256 _unlockBlock) {
        amount = balances[token][account];
        _unlockBlock = unlockBlock[account];
    }

    /**
     * unlock deposit, so that it can be withdrawn.
     * can't be called on in the same block as withdrawTo()
     */
    function unlockTokenDeposit() public {
        unlockBlock[msg.sender] = block.number;
    }

    /**
     * lock the tokens deposited for this account so they can be used to pay for gas.
     * after calling unlockTokenDeposit(), the account can't use this paymaster until the deposit is locked.
     */
    function lockTokenDeposit() public {
        unlockBlock[msg.sender] = 0;
    }

    /**
     * withdraw tokens.
     * can only be called after unlock() is called in a previous block.
     */
    function withdrawTokensTo(IERC20 token, address target, uint256 amount) public {
        require(unlockBlock[msg.sender] != 0 && block.number > unlockBlock[msg.sender], "DepositPaymaster: must unlockTokenDeposit");
        balances[token][msg.sender] -= amount;
        token.safeTransfer(target, amount);
    }

    function getTokenToEthOutputPrice(IERC20 token, uint256 ethBought) internal view virtual returns (uint256 requiredTokens) {
        IOracle oracle = oracles[token];
        require(oracle != nullOracle, "DepositPaymaster: unsupported token");
        return oracle.getTokenToEthOutputPrice(ethBought);
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 requestId, uint256 maxCost)
    external view override returns (bytes memory context) {

        (requestId);
        // make sure that verificationGas is high enough to handle postOp
        require(userOp.verificationGas > COST_OF_POST, "DepositPaymaster: gas too low for postOp");

        require(userOp.paymasterData.length == 32, "DepositPaymaster: paymasterData must specify token");
        IERC20 token = abi.decode(userOp.paymasterData, (IERC20));
        address account = userOp.getSender();
        uint256 maxTokenCost = getTokenToEthOutputPrice(token, maxCost);
        require(unlockBlock[account] == 0, "DepositPaymaster: deposit not locked");
        require(balances[token][account] >= maxTokenCost, "DepositPaymaster: deposit too low");
        return abi.encode(account, token, maxTokenCost, maxCost);
    }

    function _postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) internal override {

        (address account, IERC20 token, uint256 maxTokenCost, uint256 maxCost) = abi.decode(context, (address, IERC20, uint256, uint256));
        //use same conversion rate as used for validation.
        uint256 actualTokenCost = (actualGasCost + COST_OF_POST) * maxTokenCost / maxCost;
        if (mode != PostOpMode.postOpReverted) {
            // attempt to pay with tokens:
            token.safeTransferFrom(account, address(this), actualTokenCost);
        } else {
            //in case above transferFrom failed, pay with deposit:
            balances[token][account] -= actualTokenCost;
        }
        balances[token][owner()] += actualTokenCost;
    }
}