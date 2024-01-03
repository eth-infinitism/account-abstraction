import { parseEther } from 'ethers/lib/utils'
import { TestPaymasterAcceptAll__factory } from '../typechain'
import { ethers } from 'hardhat'
import { GasChecker } from './GasChecker'
import { Create2Factory } from '../src/Create2Factory'
import { hexValue } from '@ethersproject/bytes'

const ethersSigner = ethers.provider.getSigner()

context('Minimal Paymaster', function () {
  this.timeout(60000)
  const g = new GasChecker()

  let paymasterAddress: string
  before(async () => {
    const paymasterInit = hexValue(new TestPaymasterAcceptAll__factory(ethersSigner).getDeployTransaction(g.entryPoint().address).data!)
    paymasterAddress = await new Create2Factory(ethers.provider, ethersSigner).deploy(paymasterInit, 0)
    const paymaster = TestPaymasterAcceptAll__factory.connect(paymasterAddress, ethersSigner)
    await paymaster.addStake(1, { value: 1 })
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

  it('simple paymaster 10', async function () {
    if (g.skipLong()) this.skip()

    await g.addTestRow({ title: 'simple paymaster', count: 10, paymaster: paymasterAddress, diffLastGas: false })
    await g.addTestRow({
      title: 'simple paymaster with diff',
      count: 11,
      paymaster: paymasterAddress,
      diffLastGas: true
    })
  })
})
