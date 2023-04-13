Implementation of contracts for [ERC-4337](https://eips.ethereum.org/EIPS/eip-4337) account abstraction via alternative mempool.

# Resources

[Vitalik's post on account abstraction without Ethereum protocol changes](https://medium.com/infinitism/erc-4337-account-abstraction-without-ethereum-protocol-changes-d75c9d94dc4a)

[ETH Infinitism](https://github.com/eth-infinitism)

[Stackup](https://github.com/stackup-wallet)

## Some commands

- <details>
  <summary> get contract wallet address <code>yarn run simpleAccount address</code> </summary>

  - determinisitic に生成されるので、contract wallet を deploy する前にアドレスを把握し、あらかじめガス代を送っておく

  - このアドレスにガス代があれば、そこを `msg.sender` として tx が発行できる (コマンド例以下)
  </details>

- send ETH from contract wallet `yarn run simpleAccount transfer --to <address> --amount <eth>`

- transfer ERC20 from contract wallet `yarn run simpleAccount erc20Transfer --token <address> --to <address> --amount <decimal>`
