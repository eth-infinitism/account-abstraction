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
  TestUtil__factory,
  TokenPaymaster,
  TokenPaymaster__factory
} from "../typechain";
import {
  AddressZero,
  createWalletOwner,
  fund,
  getBalance,
  getTokenBalance, objdump, rethrow,
  checkForGeth, WalletConstructor, calcGasUsage
} from "./testutils";
import {fillAndSign} from "./UserOp";
import {parseEther} from "ethers/lib/utils";
import {UserOperation} from "./UserOperation";


describe("Singleton with paymaster", function () {

  let singleton: Singleton
  let testUtil: TestUtil
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();
  let wallet: SimpleWallet
  let redeemerAddress = '0x'.padEnd(42, '1')

  before(async function () {
    await checkForGeth()

    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    singleton = await new Singleton__factory(ethersSigner).deploy(0,0)
    walletOwner = createWalletOwner('1')
    wallet = await new SimpleWallet__factory(ethersSigner).deploy(singleton.address, await walletOwner.getAddress())
    await fund(wallet)
  })

  describe('using TokenPaymaster (account pays in paymaster tokens)', () => {
    let paymaster: TokenPaymaster
    before(async () => {
      paymaster = await new TokenPaymaster__factory(ethersSigner).deploy("tst", singleton.address)
      paymaster.addStake({value: parseEther('2')})
    })

    describe('#handleOps', () => {
      let calldata: string
      before(async () => {

        const updateSingleton = await wallet.populateTransaction.updateSingleton(AddressZero).then(tx => tx.data!)
        calldata = await wallet.populateTransaction.execFromSingleton(updateSingleton).then(tx => tx.data!)
      })
      it('paymaster should reject if wallet doesn\'t have tokens', async () => {
        const op = await fillAndSign({
          target: wallet.address,
          paymaster: paymaster.address,
          callData: calldata
        }, walletOwner, singleton)
        await expect(singleton.callStatic.handleOps([op], redeemerAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('TokenPaymaster: no balance')
        await expect(singleton.handleOps([op], redeemerAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('TokenPaymaster: no balance')
      });
    })

    describe('create account', () => {
      let createOp: UserOperation
      let created = false
      const redeemerAddress = Wallet.createRandom().address

      it('should reject if account not funded', async () => {
        const op = await fillAndSign({
          initCode: WalletConstructor(singleton.address, walletOwner.address),
          verificationGas: 1e7,
          paymaster: paymaster.address
        }, walletOwner, singleton)
        await expect(singleton.callStatic.handleOps([op], redeemerAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('TokenPaymaster: no balance')
      });

      it('should succeed to create account with tokens', async () => {
        const preAddr = await singleton.getAccountAddress(WalletConstructor(singleton.address, walletOwner.address), 0)
        await paymaster.mintTokens(preAddr, parseEther('1'))

        //paymaster is the token, so no need for "approve" or any init function...

        createOp = await fillAndSign({
          initCode: WalletConstructor(singleton.address, walletOwner.address),
          verificationGas: 1e7,
          paymaster: paymaster.address,
          nonce: 0
        }, walletOwner, singleton)

        const rcpt = await singleton.handleOps([createOp], redeemerAddress, {
          gasLimit: 1e7,
        }).catch(rethrow()).then(tx => tx!.wait())
        console.log('\t== create gasUsed=', rcpt!.gasUsed.toString())
        await calcGasUsage(rcpt, singleton)
        created = true
      });

      it('account should pay for its creation (in tst)', async function () {
        if (!created) this.skip()
        //TODO: calculate needed payment
        const ethRedeemed = await getBalance(redeemerAddress)
        expect(ethRedeemed).to.above(100000)

        const walletAddr = await singleton.getAccountAddress(WalletConstructor(singleton.address, walletOwner.address), 0)
        const postBalance = await getTokenBalance(paymaster, walletAddr)
        expect(1e18 - postBalance).to.above(10000)
      });

      it('should reject if account already created', async function () {
        if (!created) this.skip()
        await expect(singleton.callStatic.handleOps([createOp], redeemerAddress, {
          gasLimit: 1e7,
        }).catch(rethrow())).to.revertedWith('create2 failed')
      })
    })
  })
})
