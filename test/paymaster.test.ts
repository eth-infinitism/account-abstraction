import {describe} from 'mocha'
import {BigNumber, Wallet} from "ethers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  EntryPoint,
  TestUtil,
  TestUtil__factory,
  TokenPaymaster,
  TokenPaymaster__factory,
  TestCounter__factory
} from "../typechain";
import {
  AddressZero,
  createWalletOwner,
  fund,
  getBalance,
  getTokenBalance, rethrow,
  checkForGeth, WalletConstructor, calcGasUsage, deployEntryPoint, checkForBannedOps, createAddress, ONE_ETH, objdump
} from "./testutils";
import {fillAndSign} from "./UserOp";
import {formatEther, parseEther} from "ethers/lib/utils";
import {UserOperation} from "./UserOperation";
import {cleanValue} from "./chaiHelper";

describe("EntryPoint with paymaster", function () {

  let entryPoint: EntryPoint
  let testUtil: TestUtil
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();
  let wallet: SimpleWallet
  let beneficiaryAddress = '0x'.padEnd(42, '1')

  before(async function () {
    await checkForGeth()

    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    entryPoint = await deployEntryPoint(100, 10)

    walletOwner = createWalletOwner()
    wallet = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, await walletOwner.getAddress())
    await fund(wallet)
  })

  describe('#TokenPaymaster', () => {
    let paymaster: TokenPaymaster
    let otherAddr = createAddress()
    let ownerAddr: string
    let pmAddr: string

    before(async () => {
      paymaster = await new TokenPaymaster__factory(ethersSigner).deploy('ttt', entryPoint.address)
      pmAddr = paymaster.address
      ownerAddr = await ethersSigner.getAddress()
    })

    it('owner should have allowance to withdraw funds', async () => {
      expect(await paymaster.allowance(pmAddr, ownerAddr)).to.equal(ethers.constants.MaxUint256)
      expect(await paymaster.allowance(pmAddr, otherAddr)).to.equal(0)
    });

    it('should allow only NEW owner to move funds after transferOwnership', async () => {
      await paymaster.transferOwnership(otherAddr)
      expect(await paymaster.allowance(pmAddr, otherAddr)).to.equal(ethers.constants.MaxUint256)
      expect(await paymaster.allowance(pmAddr, ownerAddr)).to.equal(0)
    });
  })

  describe('using TokenPaymaster (account pays in paymaster tokens)', () => {
    let paymaster: TokenPaymaster
    before(async () => {
      paymaster = await new TokenPaymaster__factory(ethersSigner).deploy("tst", entryPoint.address)
      paymaster.addStake(0, {value: parseEther('2')})
      console.log('stake info=', cleanValue(await entryPoint.getDepositInfo(paymaster.address)))
    })

    describe('#handleOps', () => {
      let calldata: string
      before(async () => {

        const updateEntryPoint = await wallet.populateTransaction.updateEntryPoint(AddressZero).then(tx => tx.data!)
        calldata = await wallet.populateTransaction.execFromEntryPoint(wallet.address, 0, updateEntryPoint).then(tx => tx.data!)
      })
      it('paymaster should reject if wallet doesn\'t have tokens', async () => {
        const op = await fillAndSign({
          sender: wallet.address,
          paymaster: paymaster.address,
          callData: calldata
        }, walletOwner, entryPoint)
        await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('TokenPaymaster: no balance')
        await expect(entryPoint.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('TokenPaymaster: no balance')
      });
    })

    describe('create account', () => {
      let createOp: UserOperation
      let created = false
      const beneficiaryAddress = createAddress()

      it('should reject if account not funded', async () => {
        const op = await fillAndSign({
          initCode: WalletConstructor(entryPoint.address, walletOwner.address),
          verificationGas: 1e7,
          paymaster: paymaster.address
        }, walletOwner, entryPoint)
        await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('TokenPaymaster: no balance')
      });

      it('should succeed to create account with tokens', async () => {
        const preAddr = await entryPoint.getSenderAddress(WalletConstructor(entryPoint.address, walletOwner.address), 0)
        await paymaster.mintTokens(preAddr, parseEther('1'))

        //paymaster is the token, so no need for "approve" or any init function...

        createOp = await fillAndSign({
          initCode: WalletConstructor(entryPoint.address, walletOwner.address),
          verificationGas: 1e7,
          paymaster: paymaster.address,
          nonce: 0
        }, walletOwner, entryPoint)

        await entryPoint.simulateValidation(createOp, {gasLimit: 5e6}).catch(e => e.message)
        const [tx] = await ethers.provider.getBlock('latest').then(block => block.transactions)
        await checkForBannedOps(tx, true)

        const rcpt = await entryPoint.handleOps([createOp], beneficiaryAddress, {
          gasLimit: 1e7,
        }).catch(rethrow()).then(tx => tx!.wait())
        console.log('\t== create gasUsed=', rcpt!.gasUsed.toString())
        await calcGasUsage(rcpt, entryPoint)
        created = true
      });

      it('account should pay for its creation (in tst)', async function () {
        if (!created) this.skip()
        //TODO: calculate needed payment
        const ethRedeemed = await getBalance(beneficiaryAddress)
        expect(ethRedeemed).to.above(100000)

        const walletAddr = await entryPoint.getSenderAddress(WalletConstructor(entryPoint.address, walletOwner.address), 0)
        const postBalance = await getTokenBalance(paymaster, walletAddr)
        expect(1e18 - postBalance).to.above(10000)
      });

      it('should reject if account already created', async function () {
        if (!created) this.skip()
        await expect(entryPoint.callStatic.handleOps([createOp], beneficiaryAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('create2 failed')
      })

      it('batched request should each pay for its share', async () => {

        //validate context is passed correctly to postOp
        // (context is the account to pay with)

        const beneficiaryAddress = createAddress()
        const testCounter = await new TestCounter__factory(ethersSigner).deploy()
        const justEmit = testCounter.interface.encodeFunctionData('justemit')
        const execFromSingleton = wallet.interface.encodeFunctionData('execFromEntryPoint', [testCounter.address, 0, justEmit])

        let ops: UserOperation[] = []
        let wallets: SimpleWallet[] = []

        for (let i = 0; i < 4; i++) {
          const aWallet = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, await walletOwner.getAddress())
          await paymaster.mintTokens(aWallet.address, parseEther('1'))
          const op = await fillAndSign({
            sender: aWallet.address,
            callData: execFromSingleton,
            paymaster: paymaster.address
          }, walletOwner, entryPoint)

          wallets.push(aWallet)
          ops.push(op)
        }

        const pmBalanceBefore = await paymaster.balanceOf(paymaster.address).then(b => b.toNumber())
        await entryPoint.handleOps(ops, beneficiaryAddress).then(tx => tx.wait())
        const totalPaid = await paymaster.balanceOf(paymaster.address).then(b => b.toNumber()) - pmBalanceBefore
        for (let i = 0; i < wallets.length; i++) {
          let bal = await getTokenBalance(paymaster, wallets[i].address);
          const paid = parseEther('1').sub(bal.toString()).toNumber()

          //roughly each account should pay 1/4th of total price, within 10%
          // (first account pays more, for warming up..)
          expect(paid).to.be.closeTo(totalPaid / 4, paid / 10)
        }
      });

      // wallets attempt to grief paymaster: both wallets pass validatePaymasterUserOp (since they have enough balance)
      // but the execution of wallet1 drains wallet2.
      // as a result, the postOp of the paymaster reverts, and cause entire handleOp to revert.
      describe('grief attempt', () => {
        let wallet2: SimpleWallet
        let approveCallData: string
        before(async () => {
          wallet2 = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, await walletOwner.getAddress())
          await paymaster.mintTokens(wallet2.address, parseEther('1'))
          await paymaster.mintTokens(wallet.address, parseEther('1'))
          approveCallData = paymaster.interface.encodeFunctionData('approve', [wallet.address, ethers.constants.MaxUint256])
          //need to call approve from wallet2. use paymaster for that
          const approveOp = await fillAndSign({
            sender: wallet2.address,
            callData: wallet2.interface.encodeFunctionData('execFromEntryPoint', [paymaster.address, 0, approveCallData]),
            paymaster: paymaster.address
          }, walletOwner, entryPoint)
          await entryPoint.handleOps([approveOp], beneficiaryAddress)
          expect(await paymaster.allowance(wallet2.address, wallet.address)).to.eq(ethers.constants.MaxUint256)
        })

        it('griefing attempt should cause handleOp to revert', async () => {
          //wallet1 is approved to withdraw going to withdraw wallet2's balance

          const wallet2Balance = await paymaster.balanceOf(wallet2.address)
          const transferCost = parseEther('1').sub(wallet2Balance)
          const withdrawAmount = wallet2Balance.sub(transferCost.mul(0))
          const withdrawTokens = paymaster.interface.encodeFunctionData('transferFrom', [wallet2.address, wallet.address, withdrawAmount])
          // const withdrawTokens = paymaster.interface.encodeFunctionData('transfer', [wallet.address, parseEther('0.1')])
          const execFromEntryPoint = wallet.interface.encodeFunctionData('execFromEntryPoint', [paymaster.address, 0, withdrawTokens])

          const userOp1 = await fillAndSign({
            sender: wallet.address,
            callData: execFromEntryPoint,
            paymaster: paymaster.address,
          }, walletOwner, entryPoint)

          //wallet2's operation is unimportant, as it is going to be reverted - but the paymaster will have to pay for it..
          const userOp2 = await fillAndSign({
            sender: wallet2.address,
            callData: execFromEntryPoint,
            paymaster: paymaster.address,
            callGas: 1e6
          }, walletOwner, entryPoint)

          await expect(
            entryPoint.handleOps([
              userOp1,
              userOp2,
            ], beneficiaryAddress)
          ).to.be.revertedWith('transfer amount exceeds balance')
        });
      })
    })
    describe('withdraw', () => {

      const withdrawAddress = createAddress()
      it('should fail to withdraw before unstake', async () => {
        const amount = await paymaster.getDeposit()
        await expect(
          paymaster.withdrawTo(withdrawAddress, amount)
        ).to.revertedWith('must call unstakeDeposit')
      })
      it('should be able to withdraw after unstake delay', async () => {
        await paymaster.unstakeDeposit()
        const amount = await paymaster.getDeposit()
        expect(amount).to.be.gte(ONE_ETH.div(2))
        await ethers.provider.send('evm_mine', [Math.floor(Date.now() / 1000) + 100])
        await paymaster.withdrawTo(withdrawAddress, amount)
        expect(await ethers.provider.getBalance(withdrawAddress)).to.eql(amount)
        expect(await paymaster.getDeposit()).to.eq(0)
      });
    })
  })

})
