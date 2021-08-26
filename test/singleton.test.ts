import {describe} from 'mocha'
import {Wallet} from "ethers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  Singleton,
  Singleton__factory,
  TestCounter,
  TestCounter__factory,
  TestUtil,
  TestUtil__factory,
} from "../typechain";
import {AddressZero, createWalletOwner, fund, getBalance} from "./testutils";
import {fillAndSign} from "./UserOp";
import {UserOperation} from "./UserOperation";
import {PopulatedTransaction} from "ethers/lib/ethers";

describe("Singleton", function () {

  let singleton: Singleton
  let testUtil: TestUtil
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();
  let wallet: SimpleWallet

  before(async function () {
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    singleton = await new Singleton__factory(ethersSigner).deploy()
    walletOwner = createWalletOwner('1')
    wallet = await new SimpleWallet__factory(ethersSigner).deploy()
    await wallet.init(singleton.address, await walletOwner.getAddress())
    await fund(wallet)
  })

  describe('#simulateWalletValidation', () => {
    let singletonView: Singleton
    before(async () => {
      //static call must come from address zero, to validate it can only be called off-chain.
      singletonView = singleton.connect(ethers.provider.getSigner(AddressZero))
    })
    it('should fail on-chain', async () => {
      const op = await fillAndSign({target: wallet.address}, walletOwner)
      await expect(singleton.simulateWalletValidation(op)).to.revertedWith('must be called off-chain')
    });
    it('should fail if payForSelfOp fails', async () => {
      const unfundedWallet = await new SimpleWallet__factory(ethersSigner).deploy()
      await unfundedWallet.init(singleton.address, await walletOwner.getAddress())
      const op = await fillAndSign({target: unfundedWallet.address}, walletOwner)
      await expect(singletonView.callStatic.simulateWalletValidation(op)).to.revertedWith('failed to prepay')
    });
    it('should succeed if payForSelfOp succeeds', async () => {
      const op = await fillAndSign({target: wallet.address}, walletOwner)
      await singletonView.callStatic.simulateWalletValidation(op)
    });
  })

  describe('without paymaster (account pays in eth)', () => {
    describe('#handleOps', () => {
      const redeemerAddress = Wallet.createRandom().address
      let counter: TestCounter
      let call: PopulatedTransaction
      before(async () => {
        counter = await new TestCounter__factory(ethersSigner).deploy()
        const count = await counter.populateTransaction.count()
        call = await wallet.populateTransaction.exec(counter.address, count.data!)
      })

      it('wallet should pay for tx', async function () {

        const op = await fillAndSign({
          target: wallet.address,
          callData: call.data
        }, walletOwner)

        const countBefore = await counter.counters(wallet.address)
        const rcpt = await singleton.handleOps([op], redeemerAddress).then(t => t.wait())
        const countAfter = await counter.counters(wallet.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)
        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString())

        const actualGas = await rcpt.gasUsed
        const logs = await singleton.queryFilter(singleton.filters.UserOperationEvent())
        const {actualGasCost, actualGasPrice} = logs[0].args
        console.log('\t== actual gasUsed=', actualGas.toString())
        let calculatedGasUsed = actualGasCost.toNumber() / actualGasPrice.toNumber();
        console.log('\t== calculated gasUsed=', calculatedGasUsed)
        console.log('\t== gasDiff', actualGas.toNumber() - calculatedGasUsed)
        expect(await getBalance(redeemerAddress)).to.eq(actualGasCost.toNumber())
      });

      it('#handleOp (single)', async () => {
        const op = await fillAndSign({
          target: wallet.address,
          callData: call.data
        }, walletOwner)

        const countBefore = await counter.counters(wallet.address)
        const rcpt = await singleton.handleOps([op], redeemerAddress).then(t => t.wait())
        const countAfter = await counter.counters(wallet.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)

        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString())
      });
    })

    describe('create account', () => {
      const walletConstructor = SimpleWallet__factory.bytecode
      let createOp: UserOperation
      let preGas: number
      let created = false
      let redeemerAddress = Wallet.createRandom().address

      it('should reject if account not funded', async () => {
        const op = await fillAndSign({
          initCode: walletConstructor
        }, walletOwner, singleton)
        await expect(singleton.handleOps([op], redeemerAddress)).to.revertedWith('failed to prepay')
      });
      it('should succeed to create account after prefund', async () => {

        const preAddr = await singleton.getAccountAddress(walletConstructor, 0, walletOwner.address)
        await fund(preAddr)
        createOp = await fillAndSign({
          initCode: walletConstructor,
          callGas: 1e7

        }, walletOwner, singleton)

        preGas = await getBalance(redeemerAddress)
        const rcpt = await singleton.handleOps([createOp], redeemerAddress).then(tx => tx.wait())
        console.log('\t== create gasUsed=', rcpt.gasUsed.toString())
        created = true
      });

      it('account should pay for its creation', async function () {
        if (!created) this.skip()
        //TODO: calculate needed payment
        const paid = await getBalance(redeemerAddress) - preGas;
        expect(paid).to.above(100000)
      });

      it('should reject if account already created', async function () {
        if (!created) this.skip()
        await expect(singleton.handleOps([createOp], redeemerAddress)).to.revertedWith('create2 failed')
      });
    })
  })
})
