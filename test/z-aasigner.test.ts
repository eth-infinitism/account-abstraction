import {createWalletOwner, fund, getBalance} from "./testutils";
import {EntryPoint, EntryPoint__factory, TestCounter, TestCounter__factory} from "../typechain-types";
import hre, {ethers} from 'hardhat'
import {BigNumber, providers, Wallet} from 'ethers'
import {expect} from "chai";
import {before} from "mocha";
import {fail} from "assert";
import {Create2Factory} from "../src/Create2Factory";
import {formatEther, parseEther} from "ethers/lib/utils";
import './aa.init'
import {SimpleWalletSigner} from "../src/ethers/SimpleWalletSigner";

describe('SimpleWalletSigner', function () {
  this.timeout(60000)
  let entryPoint: EntryPoint
  let ethersSigner: providers.JsonRpcSigner
  let walletOwner: Wallet
  let deployedTestCounter: TestCounter
  before(async () => {

    //faster, for testing..
    SimpleWalletSigner.eventsPollingInterval = 100

    await Create2Factory.init(ethers.provider)
    ethersSigner = ethers.provider.getSigner()
    // entryPoint = await deployEntryPoint(PER_OP_OVERHEAD, UNSTAKE_DELAY_BLOCKS)
    //use deploy task. this way, the test can be repeated against real node...
    await hre.run('deploy')
    const epAddress = await hre.deployments.get('EntryPoint').then(d => d.address)
    const counterAddress = await hre.deployments.get('TestCounter').then(d => d.address)
    entryPoint = EntryPoint__factory.connect(epAddress, ethersSigner)

    walletOwner = createWalletOwner()

    // deployedTestCounter = await new TestCounter__factory(ethersSigner).deploy()
    deployedTestCounter = TestCounter__factory.connect(counterAddress, ethersSigner)
  })

  it('should fail on "eth_sendUserOperation not found" if no rpc provided ', async () => {

    //by default, eth_sendUserOperation is sent to our underlying provider. if it doesn't support (yet) our new RPC, then sendUserOpRpc must be set...
    const mysigner = new SimpleWalletSigner(walletOwner,
      {
        entryPointAddress: entryPoint.address,
        // sendUserOpRpc: debugRpcUrl(entryPoint.address, ethersSigner)
      })

    const testCounter = deployedTestCounter.connect(mysigner)
    try {
      await testCounter.count({gasLimit: 2e6})
      fail('expected to fail')
    } catch (e: any) {
      expect(e.message).to.match(/eth_sendUserOperation/)
    }
  });

  describe('seamless create', () => {
    let mysigner: SimpleWalletSigner
    let mywallet: string
    let testCounter: TestCounter
    before(async () => {
      mysigner = new SimpleWalletSigner(walletOwner,
        {
          entryPointAddress: entryPoint.address,
          debug_handleOpSigner: ethersSigner,
          // sendUserOpRpc: process.env.AA_URL ?? debugRpcUrl(entryPoint.address, ethersSigner)
        })
      mywallet = await mysigner.getAddress()
      testCounter = deployedTestCounter.connect(mysigner)
    })
    it('should fail to execute before funding', async () => {
      expect(await entryPoint.isContractDeployed(mywallet)).to.eq(false)
      try {
        await testCounter.count({gasLimit: 2e6})
        fail('should fail')
      } catch (e) {
        expect(e.message).to.contain('didn\'t pay prefund')
      }
    });
    it('should fail to create with gasLimit too low', async () => {
      expect(await entryPoint.isContractDeployed(mywallet)).to.eq(false)
      await fund(mywallet)
      await testCounter.count({gasLimit: 10000})
    });
    it('should seamless create after prefund', async function () {

      // console.log('est=', await testCounter.estimateGas.gasWaster(count,'',{gasLimit:10e6}))
      // for est:43632 need gaslimit: 29439
      // const ret = await testCounter.gasWaster(count, '', {gasLimit: 10e6, maxPriorityFeePerGas: 1e9})
      // const ret = await testCounter.count({gasLimit:19439, maxPriorityFeePerGas:1e9})
      const ret = await testCounter.count({gasLimit: 2e6})
      const rcpt = await ret.wait()
      expect(await entryPoint.isContractDeployed(mywallet)).to.eq(true, 'failed to create wallet')

      console.log('1st tx (including create) gas=', rcpt.gasUsed.toNumber())
      expect(await testCounter.counters(mywallet)).to.eq(1)
    })
    it('execute 2nd tx (on created wallet)', async function () {
      if (!await entryPoint.isContractDeployed(mywallet)) this.skip()

      const r2 = await testCounter.count().then(r => r.wait())
      console.log('2nd tx gas2=', r2.gasUsed.toNumber())
      expect(await testCounter.counters(mywallet)).to.eq(2)
    });

    it('should use deposit to pay for TX', async () => {
      await mysigner.addDeposit(ethersSigner, parseEther('1.0'))
      const preBalance = await getBalance(mywallet)

      const r3 = await testCounter.count().then(r => r.wait())
      console.log('tx gas from deposit=', r3.gasUsed.toNumber())
      expect(await getBalance(mywallet)).to.eq(preBalance, "shouldn't pay with eth but with deposit")


      const withdrawAddress = createWalletOwner().address
      await mysigner.withdrawDeposit(withdrawAddress, parseEther('0.5'))

      //withdraw left deposit (paid for above tx, and the withdraw itself)
      expect(await getBalance(withdrawAddress)).to.be.gt(0.5)
    });

  })

});
