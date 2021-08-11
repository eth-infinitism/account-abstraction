import {describe} from 'mocha'
import {BigNumber, Contract, Wallet} from "ethers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  SimpleWalletForTokens__factory,
  Singleton,
  Singleton__factory,
  TestUtil,
  TestUtil__factory,
  TestToken,
  TestToken__factory,
  TokenPaymaster,
  TokenPaymaster__factory
} from "../typechain";
import {AddressZero, createWalletOwner, fund, getBalance, getTokenBalance} from "./testutils";
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
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    singleton = await new Singleton__factory(ethersSigner).deploy()
    walletOwner = createWalletOwner('1')
    wallet = await new SimpleWallet__factory(ethersSigner).deploy()
    await wallet.init(singleton.address, await walletOwner.getAddress())
    await fund(wallet)
  })

  describe('using TokenPaymaster (account pays in TST tokens)', () => {
    let tst: TestToken
    let paymaster: TokenPaymaster
    before(async () => {
      tst = await new TestToken__factory(ethersSigner).deploy()
      paymaster = await new TokenPaymaster__factory(ethersSigner).deploy(singleton.address, tst.address)
      paymaster.addStake({value: parseEther('2')})
    })

    describe('#handleOps', () => {
      let calldata: string
      before(async () => {
        calldata = await wallet.populateTransaction.updateSingleton(AddressZero).then(tx => tx.data!)
      })
      it('paymaster should reject if wallet doesn\'t have tokens or allowance', async () => {
        const op = await fillAndSign({
          target: wallet.address,
          paymaster: paymaster.address,
          callData: calldata
        }, walletOwner)

        await expect(singleton.handleOps([op], redeemerAddress)).to.revertedWith('TokenPaymaster: no balance')
        await tst.mint(wallet.address, parseEther('1'))
        await expect(singleton.handleOps([op], redeemerAddress)).to.revertedWith('TokenPaymaster: no allowance')
      });

      //this is a scenario where an existing wallet want to start using a TokenPaymaster,
      // but first has to send a "token.approve()" transaction.
      // the paymaster should agree, but has to decode this "approval" transaction, to validate it
      // will eventually be able to get paid.
      it.skip('wallet should pay for "approve" request in TST', async function () {
        await tst.mint(wallet.address, parseEther('1'))

        const approve = await tst.populateTransaction.approve(paymaster.address, BigNumber.from('0x'.padEnd(66, 'F')))
        const execApprove = await wallet.populateTransaction.exec(tst.address, approve.data!)

        const preTokenBalance = await tst.balanceOf(wallet.address)
        const op = await fillAndSign({
          target: wallet.address,
          paymaster: paymaster.address,
          callData: execApprove.data!
        }, walletOwner)
        await singleton.handleOps([op], redeemerAddress)

        const postTokenBalance = await tst.balanceOf(wallet.address)
        const logs = await singleton.queryFilter(singleton.filters.UserOperationEvent())
        const tokenCost = preTokenBalance.sub(postTokenBalance).toNumber()
        //paymaster has fixed 100-to-1 ratio for token to eth..
        expect(tokenCost).to.closeTo(logs[0].args.actualGasCost.toNumber() / 100, tokenCost / 1000)
      });
    })

    describe('create account', () => {
      const walletConstructor = SimpleWalletForTokens__factory.bytecode
      let createOp: UserOperation
      let created = false
      const redeemerAddress = Wallet.createRandom().address

      it('should reject if account not funded', async () => {
        const op = await fillAndSign({
          initCode: walletConstructor,
          paymaster: paymaster.address
        }, walletOwner, singleton)
        await expect(singleton.handleOps([op], redeemerAddress)).to.revertedWith('TokenPaymaster: no balance')
      });

      it('should succeed to create account with tokens', async () => {
        const preAddr = await singleton.getAccountAddress(walletConstructor, 0, walletOwner.address)
        await tst.mint(preAddr, parseEther('1'))

        //TODO: find a better way to encode SimpleWalletForTokens.init() to get its ABI:
        const initFunc = await
          new Contract(AddressZero, ['function init(address _singleton, address _owner, address token, address paymaster)']).populateTransaction.init(
            singleton.address, walletOwner.address, tst.address, paymaster.address
          ).then(tx => tx.data!)

        createOp = await fillAndSign({
          initCode: walletConstructor,
          callData: initFunc,
          paymaster: paymaster.address,
          nonce: 0
        }, walletOwner, singleton)

        const rcpt = await singleton.handleOps([createOp], redeemerAddress).then(tx => tx.wait())
        console.log('\t== create gasUsed=', rcpt.gasUsed.toString())
        created = true
      });

      it('account should pay for its creation (in tst)', async function () {
        if (!created) this.skip()
        //TODO: calculate needed payment
        const ethRedeemed = await getBalance(redeemerAddress)
        expect(ethRedeemed).to.above(100000)

        const walletAddr = await singleton.getAccountAddress(walletConstructor, 0, walletOwner.address)
        const postBalance = await getTokenBalance(tst, walletAddr)
        expect(1e18-postBalance).to.above(10000)
      });

      it('should reject if account already created', async function () {
        if (!created) this.skip()
        await expect(singleton.handleOps([createOp], redeemerAddress)).to.revertedWith('create2 failed')
      });
    })
  })
})
