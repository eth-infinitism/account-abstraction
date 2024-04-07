import { GasCheckCollector, GasChecker } from './GasChecker'
import { createAccountOwner } from '../test/testutils'
import { ethers } from 'hardhat'

// TODO: NOTE: Must be executed separately as otherwise test will reuse SimpleAccount
context.only('simple account', function () {
  this.timeout(60000)
  const g = new GasChecker()

  // deployed by 'hardhat deploy' command in Zerodev repo fork
  const zkLite0 = '0xbA1ee907417BA5B9D77E7Eb53F0666972113b406'
  const zkLite1 = '0x56842B386eAd36dA47A9b1f7dE5d9b83161Cbe86'

  before(async function () {
    await GasCheckCollector.init()
    GasCheckCollector.inst.createJsonResult = true
    const zerodevKernelOwner = createAccountOwner(1000)
    console.log('zerodevKernelOwner= ', zerodevKernelOwner.address)
    await g.insertAccount(zkLite0, zerodevKernelOwner)
    await g.insertAccount(zkLite1, zerodevKernelOwner)

    await ethers.provider.getSigner().sendTransaction({ to: zkLite0, value: 1e18.toString() })
    await ethers.provider.getSigner().sendTransaction({ to: zkLite1, value: 1e18.toString() })
  })

  it('simple 1', async function () {
    await g.addTestRow({
      title: 'zd-kernel-lite',
      count: 1,
      skipAccountCreation: true,
      appendZerodevMode: true,
      diffLastGas: false
    })
    await g.addTestRow({
      title: 'zd-kernel-lite - diff from previous',
      count: 2,
      skipAccountCreation: true,
      appendZerodevMode: true,
      diffLastGas: true
    })
  })
})
