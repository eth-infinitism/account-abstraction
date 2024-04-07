import { GasCheckCollector, GasChecker } from './GasChecker'
import { createAccountOwner } from '../test/testutils'
import { ethers } from 'hardhat'

// TODO: NOTE: Must be executed separately as otherwise test will reuse SimpleAccount
context.only('simple account', function () {
  this.timeout(60000)
  const g = new GasChecker()

  // deployed by 'hardhat deploy' command in Zerodev repo fork
  const zkLite = '0xe040e67D6cE5e39C5270Da5E9DCe25e082CEe70D'

  before(async function () {
    await GasCheckCollector.init()
    GasCheckCollector.inst.createJsonResult = true
    const zerodevKernelOwner = createAccountOwner(1000)
    console.log('zerodevKernelOwner= ', zerodevKernelOwner.address)
    await g.insertAccount(zkLite, zerodevKernelOwner)

    const code = await ethers.provider.getCode(zkLite)
    console.log('code= ', code)
  })

  it('simple 1', async function () {
    await g.addTestRow({
      title: 'zd-kernel-lite',
      count: 1,
      skipAccountCreation: true,
      diffLastGas: false
    })
    await g.addTestRow({ title: 'zd-kernel-lite - diff from previous', count: 2, diffLastGas: true })
  })
})
