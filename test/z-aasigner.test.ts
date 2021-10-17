import {createWalletOwner, deployEntryPoint, fund} from "./testutils";
import {TestCounter__factory, EntryPoint__factory} from "../typechain";
import {AASigner, localUserOpSender} from "../src/AASigner";
import {ethers} from 'hardhat'
import {expect} from "chai";
import {before} from "mocha";

describe('AASigner', function () {
  before(async()=>{

  })
  it('should create', async function () {
    const ethersSigner = ethers.provider.getSigner()
    const entryPoint = await deployEntryPoint(0,0)

    const deployedTestCounter = await new TestCounter__factory(ethersSigner).deploy()
    const redeemer = createWalletOwner().address

    const walletOwner = createWalletOwner()
    expect(await entryPoint.isContractDeployed(walletOwner.address)).to.eq(false)
    const mysigner = new AASigner(walletOwner, entryPoint.address, localUserOpSender(entryPoint.address, ethersSigner, redeemer))

    const mywallet = await mysigner.getAddress()

    const testCounter = deployedTestCounter.connect(mysigner)

    await expect(testCounter.count()).to.revertedWith('didn\'t pay prefund')
    await fund(mywallet)
    // console.log('est=', await testCounter.estimateGas.gasWaster(count,'',{gasLimit:10e6}))
    // for est:43632 need gaslimit: 29439
    // const ret = await testCounter.gasWaster(count, '', {gasLimit: 10e6, maxPriorityFeePerGas: 1e9})
    // const ret = await testCounter.count({gasLimit:19439, maxPriorityFeePerGas:1e9})
    const ret = await testCounter.count({gasLimit:1000000})
    const rcpt = await ret.wait()
    console.log('1st tx (including create) gas=',rcpt.gasUsed)
    expect(await testCounter.counters(mywallet)).to.eq(1)
    const r2 = await testCounter.count().then(r=>r.wait())
    console.log('2nd tx gas2=', r2.gasUsed)
    expect(await testCounter.counters(mywallet)).to.eq(2)
  });
});
