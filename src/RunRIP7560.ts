import { ethers } from 'hardhat'
import { RIP7560Account__factory, RIP7560Paymaster__factory } from '../typechain'
import { defaultAbiCoder } from 'ethers/lib/utils'

async function main (): Promise<void> {
  const [coinbase] = await ethers.provider.listAccounts()
  console.log('Coinbase Account: ', coinbase)

  const signer = ethers.provider.getSigner(coinbase)

  const account = await new RIP7560Account__factory(signer).deploy()
  const paymaster = await new RIP7560Paymaster__factory(signer).deploy()

  const paymasterData = paymaster.address +
    ethers.utils
      .hexlify(ethers.utils.toUtf8Bytes('hello paymasters!'))
      .replace('0x', '')

  console.log('Smart Account: ', account.address)
  console.log('Paymaster: ', paymaster.address)
  console.log('Paymaster Data: ', paymasterData)

  const response = await signer.sendTransaction({
    to: account.address,
    value: 10e18.toString()
  })
  console.log('Value transfer tx hash: ', response.hash)

  console.log('=========')
  console.log('=========')

  await ethers.provider.send('eth_sendTransaction', [{
    gas: '0x5208',
    value: '0x1',
    // todo: remove 'from' field for Type 4 request
    from: coinbase,
    to: '0xf45b5e4058bfa43ae80744f206eb3aacf6cda867',
    maxFeePerGas: '0x4201eab3',
    maxPriorityFeePerGas: '0x0',
    nonce: '0x7',
    // RIP-7560 transaction fields
    sender: account.address,
    bigNonce: '0x8',
    signature: '0xbb',
    validationGas: '0x777',
    paymasterGas: '0x666',
    deployerData: '0xaa',
    paymasterData
  }])
}

void main()
