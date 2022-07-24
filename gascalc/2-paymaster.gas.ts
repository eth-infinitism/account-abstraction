import { parseEther } from 'ethers/lib/utils'
import { TestPaymasterAcceptAll__factory } from '../typechain'
import { ethers } from 'hardhat'
import { GasChecker } from './GasChecker'

const ethersSigner = ethers.provider.getSigner()

context('Minimal Paymaster', function () {
  this.timeout(60000)
  const g = new GasChecker()

  let paymasterAddress: string
  before(async () => {
    const paymaster = await new TestPaymasterAcceptAll__factory(ethersSigner).deploy(g.entryPoint().address)
    paymasterAddress = paymaster.address
    await paymaster.addStake(0, { value: 1 })
    await g.entryPoint().depositTo(paymaster.address, { value: parseEther('10') })
  })
  it('simple paymaster', async function () {
    await g.addTestRow({ title: 'simple paymaster', count: 1, paymaster: paymasterAddress, diffLastGas: false })
    await g.addTestRow({
      title: 'simple paymaster with diff',
      count: 2,
      paymaster: paymasterAddress,
      diffLastGas: true
    })
  })

  it('simple paymaster 20', async function () {
    if (g.skipLong()) this.skip()

    await g.addTestRow({ title: 'simple paymaster', count: 20, paymaster: paymasterAddress, diffLastGas: false })
    await g.addTestRow({
      title: 'simple paymaster with diff',
      count: 21,
      paymaster: paymasterAddress,
      diffLastGas: true
    })
  })
})
