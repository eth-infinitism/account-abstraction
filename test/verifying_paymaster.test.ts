import { Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  SimpleAccount,
  EntryPoint,
  VerifyingPaymaster,
  VerifyingPaymaster__factory
} from '../typechain'
import {
  createAccount,
  createAccountOwner, createAddress,
  deployEntryPoint, simulationResultCatch
} from './testutils'
import { fillAndSign } from './UserOp'
import { arrayify, hexConcat, parseEther } from 'ethers/lib/utils'
import { UserOperation } from './UserOperation'

describe('EntryPoint with VerifyingPaymaster', function () {
  let entryPoint: EntryPoint
  let accountOwner: Wallet
  const ethersSigner = ethers.provider.getSigner()
  let account: SimpleAccount
  let offchainSigner: Wallet

  let paymaster: VerifyingPaymaster
  before(async function () {
    this.timeout(20000)
    entryPoint = await deployEntryPoint()

    offchainSigner = createAccountOwner()
    accountOwner = createAccountOwner()

    paymaster = await new VerifyingPaymaster__factory(ethersSigner).deploy(entryPoint.address, offchainSigner.address)
    await paymaster.addStake(1, { value: parseEther('2') })
    await entryPoint.depositTo(paymaster.address, { value: parseEther('1') });
    ({ proxy: account } = await createAccount(ethersSigner, accountOwner.address, entryPoint.address))
  })

  describe('#parsePaymasterAndData', () => {
    it('should parse data properly', async () => {
      const paymasterAndData = hexConcat([paymaster.address, '0x0000000012345678', '0x0000000000001234', '0x1234'])
      const res = await paymaster.parsePaymasterAndData(paymasterAndData)
      expect(res.validUntil.toNumber()).equal(305419896)
      expect(res.validAfter.toNumber()).equal(4660)
      expect(res.signature).equal('0x1234')
    })
  })

  describe('#validatePaymasterUserOp', () => {
    it('should reject on no signature', async () => {
      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, '0x0000000012345678', '0x0000000000001234', '0x1234'])
      }, accountOwner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(userOp)).to.be.revertedWith('invalid signature length in paymasterAndData')
    })

    it('should reject on invalid signature', async () => {
      const userOp = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, '0x0000000012345678', '0x0000000000001234', '0x' + '00'.repeat(65)])
      }, accountOwner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(userOp)).to.be.revertedWith('ECDSA: invalid signature')
    })

    describe('with wrong signature', () => {
      let wrongSigUserOp: UserOperation
      const beneficiaryAddress = createAddress()
      before(async () => {
        const sig = await offchainSigner.signMessage(arrayify('0xdead'))
        wrongSigUserOp = await fillAndSign({
          sender: account.address,
          paymasterAndData: hexConcat([paymaster.address, '0x000000007B9F2E9D', '0x0000000000001234', sig])
        }, accountOwner, entryPoint)
      })

      it('should return signature error (no revert) on wrong signer signature', async () => {
        const ret = await entryPoint.callStatic.simulateValidation(wrongSigUserOp).catch(simulationResultCatch)
        expect(ret.returnInfo.sigFailed).to.be.true
      })

      it('handleOp revert on signature failure in handleOps', async () => {
        await expect(entryPoint.estimateGas.handleOps([wrongSigUserOp], beneficiaryAddress)).to.revertedWith('AA34 signature error')
      })
    })

    it('succeed with valid signature', async () => {
      const userOp1 = await fillAndSign({
        sender: account.address,
        paymasterAndData: hexConcat([paymaster.address, '0x000000007B9F2E9D', '0x0000000000000000'])
      }, accountOwner, entryPoint)
      const hash = await paymaster.getHash(userOp1)
      const sig = await signEIP712(offchainSigner, paymaster, hash, 2074029725, 0, (await paymaster.senderNonce(account.address)).toNumber())
      const userOp = await fillAndSign({
        ...userOp1,
        paymasterAndData: hexConcat([paymaster.address, '0x000000007B9F2E9D', '0x0000000000000000', sig])
      }, accountOwner, entryPoint)
      const res = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
      expect(res.returnInfo.sigFailed).to.be.false
      expect(res.returnInfo.validAfter).to.be.equal(0)
      expect(res.returnInfo.validUntil).to.be.equal(2074029725 - 1)
    })
  })
})

async function signEIP712 (
  signer: Wallet,
  contract: VerifyingPaymaster,
  hash: string,
  validUntil: number,
  validAfter: number,
  nonce: number
): Promise<string> {
  const domain = {
    name: 'VerifyingPaymaster',
    version: '0.0.1',
    chainId: 31337,
    verifyingContract: contract.address
  }
  const types = {
    ValidatePaymasterUserOp: [
      { name: 'hash', type: 'bytes32' },
      { name: 'validUntil', type: 'uint64' },
      { name: 'validAfter', type: 'uint64' },
      { name: 'senderNonce', type: 'uint256' }
    ]
  }
  const value = {
    hash: hash,
    validUntil: validUntil,
    validAfter: validAfter,
    senderNonce: nonce
  }
  return await signer._signTypedData(domain, types, value)
}
