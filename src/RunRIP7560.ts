import { ethers } from 'hardhat'
import { RIP7560Account__factory, RIP7560Paymaster__factory } from '../typechain'
import { question } from 'readline-sync'

async function main (): Promise<void> {
  const [coinbase] = await ethers.provider.listAccounts()
  console.log('Coinbase Account: ', coinbase)

  const signer = ethers.provider.getSigner(coinbase)

  const account = await new RIP7560Account__factory(signer).deploy()
  const revertValidation = (parseInt(process.env.REVERT!) !== 0) ?? false
  const paymaster = await new RIP7560Paymaster__factory(signer).deploy(revertValidation)

  const paymasterData = paymaster.address +
    ethers.utils
      .hexlify(ethers.utils.toUtf8Bytes('hello paymasters!'))
      .replace('0x', '')

  console.log('Smart Account: ', account.address)
  console.log('Paymaster: ', paymaster.address, ' reverts: ', revertValidation)
  console.log('Paymaster Data: ', paymasterData)

  const response = await signer.sendTransaction({
    to: account.address,
    value: 10e18.toString()
  })
  console.log('Value transfer tx hash: ', response.hash)

  question('Press enter to send AA transaction:>')

  const type4transaction1 = {
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
  }
  // const type4transaction2 = {
  //   ...type4transaction1,
  //   to: '0xaa5b5e4058bfa43ae80744f206eb3aacf6cda867',
  //   nonce: '0x8'
  // }
  const responseAA1 = await ethers.provider.send('eth_sendTransaction', [type4transaction1])
  // const responseAA2 = await ethers.provider.send('eth_sendTransaction', [type4transaction2])

  console.log('=========')
  console.log('AA transactions sent. Responses:')
  console.warn(JSON.stringify(responseAA1))

  const receipt = await ethers.provider.getTransactionReceipt(responseAA1)
  console.log('Receipt:', JSON.stringify(receipt))
  // console.warn(JSON.stringify(responseAA2))
}

void main()
