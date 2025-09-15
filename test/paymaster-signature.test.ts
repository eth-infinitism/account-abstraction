import {
  createAccount,
  createAccountOwner,
  createAddress, decodeRevertReason,
  deployEntryPoint
} from './testutils'
import { fillAndSign, fillSignAndPack, packUserOp, encodePaymasterSignature } from './UserOp'
import { ethers } from 'hardhat'
import {
  EntryPoint, SimpleAccount,
  TestPaymasterWithSig, TestPaymasterWithSig__factory
} from '../typechain'
import { expect } from 'chai'
import { defaultAbiCoder, hexConcat, parseEther } from 'ethers/lib/utils'

describe('#paymaster-signature', () => {
  const ethersSigner = ethers.provider.getSigner()
  let entryPoint: EntryPoint

  let paymaster: TestPaymasterWithSig

  const beneficiary = createAddress()
  let account: SimpleAccount

  before(async function () {
    entryPoint = await deployEntryPoint()

    paymaster = await new TestPaymasterWithSig__factory(ethersSigner).deploy(entryPoint.address)
    await entryPoint.depositTo(paymaster.address, { value: parseEther('1') })
    const created = await createAccount(ethersSigner, owner.address, entryPoint.address)
    account = created.proxy
  })

  const owner = createAccountOwner()
  const signedPmd = defaultAbiCoder.encode(['uint256'], ['0x11'])
  it('test without any paymasterSig', async () => {
    const op = await fillSignAndPack({
      sender: account.address,
      paymaster: paymaster.address,
      paymasterData: signedPmd
    }, owner, entryPoint)

    expect(await entryPoint.handleOps([op], beneficiary)
      .catch(decodeRevertReason)).to
      .match(/missing paymasterSig/)
  })

  it('test with paymasterSig', async () => {
    // sign with any signature (even empty) - but it does encode it with the magic suffix.
    const op = await fillAndSign({
      sender: account.address,
      paymaster: paymaster.address,
      paymasterData: signedPmd,
      paymasterSignature: '0x12'
    }, owner, entryPoint)

    op.paymasterSignature = defaultAbiCoder.encode(['uint256', 'uint256'], [10, 90])

    // submit userOp with paymasterSignature
    await entryPoint.callStatic.handleOps([packUserOp(op)], beneficiary)
      .catch(e => {
        throw new Error(decodeRevertReason(e)!)
      })

    const unsignedPmd = defaultAbiCoder.encode(['uint256'], ['0xaa11'])
    op.paymasterData = hexConcat([
      unsignedPmd,
      encodePaymasterSignature(
        defaultAbiCoder.encode(['uint256', 'uint256'], [10, 90]))
    ])

    // modifying paymasterData should cause signature failure
    expect(await entryPoint.handleOps([packUserOp(op)], beneficiary).catch(decodeRevertReason)).to.match(/AA24 signature error/)
  })
})
