import {parseEther} from "ethers/lib/utils";
import {TestPaymasterAcceptAll__factory} from "../typechain";
import {ethers} from "hardhat";
import {GasChecker} from "./gasChecker";

const ethersSigner = ethers.provider.getSigner()

context('Minimal Paymaster', function () {
  this.timeout(20000)
  let g: GasChecker

  before(async function () {
    g = await GasChecker.init()
  })

  let paymasterAddress: string
  before(async () => {
    const paymaster = await new TestPaymasterAcceptAll__factory(ethersSigner).deploy(g.gasCheckEntryPoint.address)
    paymasterAddress = paymaster.address
    await paymaster.addStake(0, {value: 1})
    await g.gasCheckEntryPoint.depositTo(paymaster.address, {value: parseEther('10')})
  })
  it('simple paymaster', async function () {

    g.addRow(await g.runTest({title: "simple paymaster", count: 1, paymaster: paymasterAddress, diffLastGas: false}))
    g.addRow(await g.runTest({
      title: "simple paymaster with diff",
      count: 2,
      paymaster: paymasterAddress,
      diffLastGas: true
    }))
  })

  it('simple paymaster 50', async function () {
    if (g.skipLong()) this.skip()

    g.addRow(await g.runTest({title: "simple paymaster", count: 50, paymaster: paymasterAddress, diffLastGas: false}))
    g.addRow(await g.runTest({
      title: "simple paymaster with diff",
      count: 51,
      paymaster: paymasterAddress,
      diffLastGas: true
    }))
  })
})
