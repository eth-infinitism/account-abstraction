import {describe} from 'mocha'
import {Wallet} from "ethers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  EntryPoint,
  TestUtil,
  TestUtil__factory,
  TokenPaymaster,
  TokenPaymaster__factory
} from "../typechain";
import {
  AddressZero,
  createWalletOwner,
  fund,
  getBalance,
  getTokenBalance, rethrow,
  checkForGeth, WalletConstructor, calcGasUsage, deployEntryPoint, checkForBannedOps, createAddress, ONE_ETH
} from "./testutils";
import {fillAndSign} from "./UserOp";
import {parseEther} from "ethers/lib/utils";
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

        console.log('simulate result=',
          await entryPoint.simulateValidation(createOp, {gasLimit: 5e6}).catch(e => e.message)
        )
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
