import { parseEther } from 'ethers/lib/utils'
import { VerifyingPaymaster, VerifyingPaymaster__factory } from '../typechain'
import { ethers } from 'hardhat'
import { GasCheckCollector, GasChecker } from './GasChecker'

const ethersSigner = ethers.provider.getSigner()

context('Verifying Paymaster', function () {
  this.timeout(60000)
  const g = new GasChecker()

  let paymaster: VerifyingPaymaster

  before(async () => {
    // const paymasterInit = hexValue(new TestPaymasterAcceptAll__factory(ethersSigner).getDeployTransaction(g.entryPoint().address).data!)
    const entryPointAddress = g.entryPoint().address
    paymaster = await new VerifyingPaymaster__factory(ethersSigner).deploy(entryPointAddress, g.accountOwner.address)
    GasCheckCollector.inst.setContractName(paymaster.address, 'VerifyingPaymaster')

    await paymaster.addStake(1, { value: 1 })
    await g.entryPoint().depositTo(paymaster.address, { value: parseEther('10') })
  })

  it('verifying paymaster', async function () {
    await g.createAccounts1(2)
    await g.addTestRow({
      title: 'verifying paymaster',
      count: 1,
      paymaster: paymaster.address,
      verifyingPaymaster: true,
      diffLastGas: false
    })
    await g.addTestRow({
      title: 'verifying paymaster with diff',
      count: 2,
      paymaster: paymaster.address,
      verifyingPaymaster: true,
      diffLastGas: true
    })
  })

  it.skip('simple paymaster 10', async function () {
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
