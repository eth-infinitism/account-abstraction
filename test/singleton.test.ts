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
import {
  AddressZero,
  createWalletOwner,
  fund,
  getBalance,
  checkForGeth,
  rethrow, tostr, WalletConstructor
} from "./testutils";
import {fillAndSign, ZeroUserOp} from "./UserOp";
import {UserOperation} from "./UserOperation";
import {PopulatedTransaction} from "ethers/lib/ethers";
import {BytesLike} from "@ethersproject/bytes";

describe("Singleton", function () {

  let singleton: Singleton
  let testUtil: TestUtil
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();
  let wallet: SimpleWallet

  before(async function () {

    await checkForGeth()
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    singleton = await new Singleton__factory(ethersSigner).deploy()
    walletOwner = createWalletOwner()
    wallet = await new SimpleWallet__factory(ethersSigner).deploy(singleton.address, await walletOwner.getAddress())
    await fund(wallet)
  })

  describe('#simulateWalletValidation', () => {
    let singletonView: Singleton
    const walletOwner1 = createWalletOwner()
    let wallet1: SimpleWallet

    before(async () => {
      //static call must come from address zero, to validate it can only be called off-chain.
      singletonView = singleton.connect(ethers.provider.getSigner(AddressZero))
      wallet1 = await new SimpleWallet__factory(ethersSigner).deploy(singleton.address, await walletOwner1.getAddress())
    })
    it('should fail on-chain', async () => {
      const op = await fillAndSign({target: wallet1.address}, walletOwner1)
      await expect(singleton.simulateWalletValidation(op)).to.revertedWith('must be called off-chain')
    });
    it('should fail if payForSelfOp fails', async () => {
      //using wrong owner for wallet1
      const op = await fillAndSign({target: wallet1.address}, walletOwner)
      await expect(singletonView.callStatic.simulateWalletValidation(op).catch(rethrow())).to
        .revertedWith('wrong signature')
    });
    it('should succeed if payForSelfOp succeeds', async () => {
      const op = await fillAndSign({target: wallet1.address}, walletOwner1)
      await fund(wallet1)
      const ret = await singletonView.callStatic.simulateWalletValidation(op).catch(rethrow())
      console.log('   === simulate result', ret)
    });
    it('should fail creation for wrong target', async () => {
      const op1 = await fillAndSign({
        initCode: WalletConstructor(singleton.address, walletOwner1.address),
        target: '0x'.padEnd(42,'1')
      }, walletOwner1, singleton)
      await expect(singletonView.callStatic.simulateWalletValidation(op1).catch(rethrow()))
        .to.revertedWith('target doesn\'t match create2 address')
    })
    it('should succeed for creating a wallet', async () => {
      const op1 = await fillAndSign({
        initCode: WalletConstructor(singleton.address, walletOwner1.address),
      }, walletOwner1, singleton)
      await fund(op1.target)
      await singletonView.callStatic.simulateWalletValidation(op1).catch(rethrow())
    })
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

        // await testEthersParam()
        ZeroUserOp.maxFeePerGas = 0
        ZeroUserOp.maxPriorityFeePerGas = 0
        const op = await fillAndSign({
          target: wallet.address,
          callData: call.data,
          maxPriorityFeePerGas: 0,
          maxFeePerGas: 0
        }, walletOwner)

        const countBefore = await counter.counters(wallet.address)
        //for estimateGas, must specify maxFeePerGas, otherwise our gas check fails
        console.log('  == est gas=', await singleton.estimateGas.handleOps([op], redeemerAddress, {maxFeePerGas: 1e9}).then(tostr))

        //must specify at least on of maxFeePerGas, gasLimit
        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        const rcpt = await singleton.handleOps([op], redeemerAddress, {
          gasLimit: 1e7
        }).then(t => t.wait())

        const countAfter = await counter.counters(wallet.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)
        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)

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
        const rcpt = await singleton.handleOp(op, redeemerAddress, {
          gasLimit: 1e7
        }).then(t => t.wait())
        const countAfter = await counter.counters(wallet.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)

        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)

      });
    })

    //not sure with "expect(call).to.be.revertedWith()" doesn't work.
    async function expectRevert<T>(call: Promise<T>, match: RegExp) {
      try {
        await call.catch(rethrow())
        throw new Error(`expected revert with ${match}`)
      } catch (e) {
        expect(e.message).to.match(match)
      }
    }

    describe('create account', () => {
      let createOp: UserOperation
      let preGas: number
      let created = false
      let redeemerAddress = Wallet.createRandom().address

      it('should reject create if target address not set', async () => {

        const op = await fillAndSign({
          initCode: WalletConstructor(singleton.address, walletOwner.address),
          verificationGas: 2e6,
          target: '0x'.padEnd(42, '1')
        }, walletOwner, singleton)

        await expectRevert(singleton.handleOps([op], redeemerAddress, {
          gasLimit: 1e7
        }), /target doesn't match create2 address/)
      });

      it('should reject create if account not funded', async () => {

        const op = await fillAndSign({
          initCode: WalletConstructor(singleton.address, walletOwner.address),
          verificationGas: 2e6
        }, walletOwner, singleton)

        await expectRevert(singleton.handleOps([op], redeemerAddress, {
          gasLimit: 1e7
        }), /didn't pay prefund/)
        await expect(await ethers.provider.getCode(op.target).then(x => x.length)).to.equal(2, "wallet exists before creation")
      });

      it('should succeed to create account after prefund', async () => {

        const preAddr = await singleton.getAccountAddress(WalletConstructor(singleton.address, walletOwner.address), 0)
        await fund(preAddr)
        createOp = await fillAndSign({
          initCode: WalletConstructor(singleton.address, walletOwner.address),
          callGas: 1e7,
          verificationGas: 2e6

        }, walletOwner, singleton)

        await expect(await ethers.provider.getCode(preAddr).then(x => x.length)).to.equal(2, "wallet exists before creation")
        preGas = await getBalance(redeemerAddress)
        const rcpt = await singleton.handleOps([createOp], redeemerAddress, {
          gasLimit: 1e7,
        }).then(tx => tx.wait()).catch(rethrow())
        console.log('\t== create gasUsed=', rcpt!.gasUsed.toString())
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
        await expect(singleton.handleOps([createOp], redeemerAddress, {
          gasLimit: 1e7
        })).to.revertedWith('create2 failed')
      });
    })
  })
})
