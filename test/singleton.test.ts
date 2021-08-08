import {describe} from 'mocha'
import {Wallet} from "ethers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  Singleton,
  Singleton__factory,
  TestUtil,
  TestUtil__factory
} from "../typechain";
import {AddressZero, createWalletOwner, fund, getBalance, tonumber, tostr} from "./testutils";
import {fillAndSign, UserOperation} from "./UserOp";
import exp from "constants";

describe("Singleton", function () {

  let singleton: Singleton
  let testUtil: TestUtil
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();
  let wallet: SimpleWallet
  let redeemerAddress = '0x'.padEnd(42, '1')

  const privkey = '0x'.padEnd(66, '9')

  before(async function () {
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    singleton = await new Singleton__factory(ethersSigner).deploy()
    walletOwner = createWalletOwner('1')
    wallet = await new SimpleWallet__factory(ethersSigner).deploy()
    await wallet.init(singleton.address, await walletOwner.getAddress())
    await fund(wallet)
  })

  describe('#simulateOp', () => {
    let singletonView: Singleton
    before(async () => {
      singletonView = singleton.connect(ethers.provider.getSigner(AddressZero))
    })
    it('should fail on-chain', async () => {
      const op = await fillAndSign({target: wallet.address}, walletOwner)
      await expect(singleton.simulateOp(op)).to.revertedWith('must be called off-chain')
    });
    it('should fail if payForSelfOp fails', async () => {
      const unfundedWallet = await new SimpleWallet__factory(ethersSigner).deploy()
      await unfundedWallet.init(singleton.address, await walletOwner.getAddress())
      const op = await fillAndSign({target: unfundedWallet.address}, walletOwner)
      await expect(singletonView.callStatic.simulateOp(op)).to.revertedWith('failed to prepay')
    });
    it('should succeed if payForSelfOp succeeds', async () => {
      const nonce = await wallet.nonce()
      const op = await fillAndSign({target: wallet.address, nonce}, walletOwner)
      await singletonView.callStatic.simulateOp(op)
    });
  })

  describe('#handleOps without paymaster', () => {
    it('wallet should pay for tx', async function () {
      const nonce = await wallet.nonce()
      const call = await wallet.populateTransaction.updateSingleton(AddressZero)

      let walletAsOwner = wallet.connect(ethers.provider.getSigner(walletOwner.address))
      const op = await fillAndSign({
        target: wallet.address, nonce,
        maxFeePerGas: await ethersSigner.getGasPrice(),
        callData: call.data
      }, walletOwner)
      const rcpt = await singleton.handleOps([op], redeemerAddress).then(t => t.wait())
      const actualGas = await rcpt.gasUsed
      const logs = await singleton.queryFilter(singleton.filters.UserOperationEvent())
      const {actualGasCost, actualGasPrice} = logs[0].args
      console.log('\t== actual gasUsed=', actualGas.toString())
      let calculatedGasUsed = actualGasCost.toNumber() / actualGasPrice.toNumber();
      console.log('\t== calculated gasUsed=', calculatedGasUsed)
      console.log('\t== gasDiff', actualGas.toNumber() - calculatedGasUsed)
      expect(await getBalance(redeemerAddress)).to.eq(actualGasCost)
    });
  })

  describe('create account', () => {
    const walletConstructor = SimpleWallet__factory.bytecode
    let createOp: UserOperation
    let preGas: number
    let created = false

    it('should reject if account not funded', async () => {
      const op = await fillAndSign({
        target: AddressZero,
        callData: walletConstructor
      }, walletOwner)
      await expect(singleton.handleOps([op], redeemerAddress)).to.revertedWith('failed to prepay')
    });
    it('should succeed to create account after prefund', async () => {
      const preAddr = await singleton.getAccountAddress(walletConstructor, 0)
      await fund(preAddr)
      createOp = await fillAndSign({
        target: AddressZero,
        callData: walletConstructor,
        // callGas: 1e6, //TODO: estimate creation gas
        maxFeePerGas: await ethersSigner.getGasPrice()
      }, walletOwner)

      preGas = await getBalance(redeemerAddress)
      const rcpt = await singleton.handleOps([createOp], redeemerAddress).then(tx => tx.wait())
      console.log('\t== create gasUsed=', rcpt.gasUsed.toString())
      created = true
    });

    it('account should pay for its creation ', async function () {
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
