import {describe} from 'mocha'
import {Wallet} from "ethers";
import {ethers} from "hardhat";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  EntryPoint,
  VerifyingPaymaster,
  VerifyingPaymaster__factory
} from "../typechain";
import {
  AddressZero,
  createWalletOwner,
  deployEntryPoint
} from "./testutils";
import {fillAndSign} from "./UserOp";
import {arrayify, parseEther} from "ethers/lib/utils";

describe("EntryPoint with VerifyingPaymaster", function () {

  let entryPoint: EntryPoint
  let entryPointStatic: EntryPoint
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();
  let wallet: SimpleWallet
  let offchainSigner: Wallet

  let paymaster: VerifyingPaymaster
  before(async function () {

    entryPoint = await deployEntryPoint(0, 0)
    entryPointStatic = entryPoint.connect(AddressZero)

    offchainSigner = createWalletOwner()
    walletOwner = createWalletOwner()

    paymaster = await new VerifyingPaymaster__factory(ethersSigner).deploy(entryPoint.address, offchainSigner.address)
    paymaster.addStake(0, {value: parseEther('2')})

    wallet = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, walletOwner.address)

  })

  describe('#validatePaymasterUserOp', () => {
    it('should reject on no signature', async () => {
      const userOp = await fillAndSign({
        sender: wallet.address,
        paymaster: paymaster.address,
        paymasterData: '0x1234'
      }, walletOwner, entryPoint)
      await expect(entryPointStatic.callStatic.simulateValidation(userOp)).to.be.revertedWith('invalid signature length in paymasterData')
    });
    
    it('should reject on invalid signature', async () => {
      const userOp = await fillAndSign({
        sender: wallet.address,
        paymaster: paymaster.address,
        paymasterData: '0x' + '1c'.repeat(65)
      }, walletOwner, entryPoint)
      await expect(entryPointStatic.callStatic.simulateValidation(userOp)).to.be.revertedWith('ECDSA: invalid signature')
    });

    it('succeed with valid signature', async () => {
      const userOp1 = await fillAndSign({
        sender: wallet.address,
        paymaster: paymaster.address,
      }, walletOwner, entryPoint)
      const hash = await paymaster.getHash(userOp1)
      const sig = await offchainSigner.signMessage(arrayify(hash))
      const userOp = await fillAndSign({
        ...userOp1,
        paymasterData: sig
      }, walletOwner, entryPoint)
      await entryPointStatic.callStatic.simulateValidation(userOp)
    });
  })
})
