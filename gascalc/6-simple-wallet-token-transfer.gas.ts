import { GasCheckCollector } from './GasChecker'
import { createAddress } from '../test/testutils'
import { ethers } from 'hardhat'
import { TestERC20, TestERC20__factory } from '../typechain'

// TODO: NOTE: Must be executed separately as otherwise test will reuse SimpleAccount
context.only('ERC-20 Token related', function () {
  let token: TestERC20

  before(async function () {
    await GasCheckCollector.init()
    GasCheckCollector.inst.createJsonResult = true
    token = await new TestERC20__factory(ethers.provider.getSigner()).deploy(18)
  })

  it('simple 1', async function () {
    const destEoa = createAddress()
    const tx = await token.transfer(destEoa, 100)
    const receipt = await ethers.provider.getTransactionReceipt(tx.hash)
    console.log(`ERC-20 EOA -> EOA transfer: status = ${receipt.status}; gasUsed = ${receipt.gasUsed.toString()}; txid = ${receipt.transactionHash}`)
  })
})
