// SPDX-License-Identifier:MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice The minimal "Wrapped Ether" ERC-20 token implementation.
 */
contract TestWrappedNativeToken is ERC20 {

    // solhint-disable-next-line no-empty-blocks
    constructor() ERC20("Wrapped Native Token", "wnTok") {
    }

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint amount) public {
        _burn(msg.sender, amount);
        // solhint-disable-next-line avoid-low-level-calls
        (bool success,) = msg.sender.call{value:amount}("");
        require(success, "transfer failed");
    }
}
