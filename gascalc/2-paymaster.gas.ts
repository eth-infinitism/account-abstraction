import {parseEther} from "ethers/lib/utils";
import {TestPaymasterAcceptAll__factory} from "../typechain";
import {addRow, gasCheckEntryPoint, runTest} from "./gasChecker";
import {ethers} from "hardhat";

const ethersSigner = ethers.provider.getSigner()

context('Minimal Paymaster', function () {
  this.timeout(20000)

  let paymasterAddress: string
  before(async () => {
    const paymaster = await new TestPaymasterAcceptAll__factory(ethersSigner).deploy(gasCheckEntryPoint.address)
    paymasterAddress = paymaster.address
    await paymaster.addStake(0, {value: 1})
    await gasCheckEntryPoint.depositTo(paymaster.address, {value: parseEther('10')})
  })
  it('simple paymaster', async function () {

    addRow(await runTest({title: "simple paymaster", count: 1, paymaster: paymasterAddress, diffLastGas: false}))
    addRow(await runTest({
      title: "simple paymaster with diff",
      count: 2,
      paymaster: paymasterAddress,
      diffLastGas: true
    }))
  })

  it('simple paymaster 50', async function () {

    addRow(await runTest({title: "simple paymaster", count: 50, paymaster: paymasterAddress, diffLastGas: false}))
    addRow(await runTest({
      title: "simple paymaster with diff",
      count: 51,
      paymaster: paymasterAddress,
      diffLastGas: true
    }))
  })
})
