import {describe} from 'mocha'
import {Wallet} from "ethers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  TestUtil,
  TestUtil__factory
} from "../typechain";
import {AddressZero, createWalletOwner, getBalance, ONE_ETH, tostr} from "./testutils";
import {fillUserOp, packUserOp, signUserOp, UserOperation, ZeroUserOp} from "./UserOp";
import {parseEther} from "ethers/lib/utils";
import exp from "constants";


describe("SimpleWallet", function () {

  const singleton = '0x'.padEnd(42, '2')
  let accounts: string[]
  let testUtil: TestUtil
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();

  before(async () => {
    accounts = await ethers.provider.listAccounts()
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    walletOwner = createWalletOwner('2')
  })

  it('owner should be able to call transfer', async () => {
    const wallet = await new SimpleWallet__factory(ethers.provider.getSigner()).deploy()
    await wallet.init(singleton, accounts[0])
    await ethersSigner.sendTransaction({from: accounts[0], to: wallet.address, value: parseEther('10')})
    await wallet.transfer(accounts[2], ONE_ETH)
  });
  it('other account should not be able to call transfer', async () => {
    const wallet = await new SimpleWallet__factory(ethers.provider.getSigner()).deploy()
    await wallet.init(singleton, accounts[0])
    await expect(wallet.connect(ethers.provider.getSigner(1)).transfer(accounts[2], ONE_ETH))
      .to.be.revertedWith('only through')
  });

  it('should pack in js the same as solidity', async () => {
    const op = await fillUserOp({target: accounts[0]})
    const packed = packUserOp(op)
    expect(await testUtil.packUserOp(op)).to.equal(packed)
  });

  describe('#payForSelfOp', () => {
    let wallet: SimpleWallet
    let userOp: UserOperation
    let preBalance: number
    let expectedPay: number

    before(async () => {
      //that's the account of ethersSigner
      const singleton = accounts[2]
      wallet = await new SimpleWallet__factory(await ethers.getSigner(singleton)).deploy()
      await wallet.init(singleton, walletOwner.address)
      await ethersSigner.sendTransaction({from: accounts[0], to: wallet.address, value: parseEther('0.2')})
      const callGas = 5
      const maxFeePerGas = 3e9
      userOp = signUserOp(fillUserOp({target: wallet.address, callGas, maxFeePerGas}), walletOwner)
      expectedPay = maxFeePerGas * callGas
      preBalance = await getBalance(wallet.address)
      const ret = await wallet.payForSelfOp(userOp)
      await ret.wait()
    })

    it('should pay', async () => {

      expect(await testUtil.prefund(userOp)).to.equal(expectedPay);
      const postBalance = await getBalance(wallet.address)
      expect(preBalance - postBalance).to.eql(expectedPay)
    });

    it('should increment nonce', async () => {
      expect(await wallet.nonce()).to.equal(1)
    });
    it('should reject same TX on nonce error', async () => {
      await expect(wallet.payForSelfOp(userOp)).to.revertedWith("invalid nonce")
    });

  })
})
