import { createAddress, decodeRevertReason, deployEntryPoint } from './testutils'
import { EntryPoint, TestHelpers, TestHelpers__factory } from '../typechain'
import { UserOperation } from './UserOperation'
import { getUserOpHash, PAYMASTER_SIG_MAGIC, packUserOp } from './UserOp'
import { expect } from 'chai'
import { hexConcat, hexDataLength, hexDataSlice, hexZeroPad, keccak256 } from 'ethers/lib/utils'
import { ethers } from 'hardhat'

import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

chai.use(chaiAsPromised)

const provider = ethers.provider
const ethersSigner = provider.getSigner()

// encode a paymaster signature, to append to the paymasterData field.
export function encodePaymasterSignature (pmSig: string): string {
  if (pmSig.length <= 2) {
    return '0x'
  }
  return hexConcat([pmSig, hexZeroPad('0x' + hexDataLength(pmSig).toString(16), 2), PAYMASTER_SIG_MAGIC])
}

describe('#getUserOpHash', () => {
  let entryPoint: EntryPoint

  let chainId: number
  before(async () => {
    entryPoint = await deployEntryPoint()
    chainId = (await entryPoint.provider.getNetwork()).chainId
  })

  const defaultUserOp: UserOperation = {
    sender: createAddress(),
    nonce: 123,
    callData: '0xca11',
    callGasLimit: 10,
    verificationGasLimit: 20,
    preVerificationGas: 30,
    maxFeePerGas: 40,
    maxPriorityFeePerGas: 50,
    signature: '0xdeadface',
    paymaster: createAddress(),
    paymasterVerificationGasLimit: 60,
    paymasterPostOpGasLimit: 70,
    paymasterData: '0xcafe'
  }

  describe('UserOperationLib funcs', () => {
    let helpers: TestHelpers
    before(async () => {
      helpers = await new TestHelpers__factory(ethersSigner).deploy()
    })
    it('#encodePaymasterSignature', async () => {
      expect(await helpers.encodePaymasterSignature('0x')).to.equal(
        encodePaymasterSignature('0x'))
      expect(await helpers.encodePaymasterSignature('0x123456')).to.equal(
        encodePaymasterSignature('0x123456'))
    })

    it('#getPaymasterSignatureLength', async () => {
      expect(await helpers.getPaymasterSignatureLength('0x')).to.equal(0)
      expect(await helpers.getPaymasterSignatureLength('0x1234')).to.equal(0)
      expect(await helpers.getPaymasterSignatureLength(hexConcat([hexZeroPad('0x', 52), '0x0000', PAYMASTER_SIG_MAGIC]))).to.equal(0)
      expect(await helpers.getPaymasterSignatureLength(hexConcat([hexZeroPad('0x', 53), '0x0001', PAYMASTER_SIG_MAGIC]))).to.equal(1)
    })
    it('#getPaymasterSignatureLength should not extend before paymasterData', async () => {
      await expect(helpers.getPaymasterSignatureLength(hexConcat([hexZeroPad('0x', 52), '0x0001', PAYMASTER_SIG_MAGIC]))
        .catch(e => {
          throw new Error(decodeRevertReason(e.data)!)
        }))
        .to.be.rejectedWith('InvalidPaymasterSignatureLength(62,1)')
      await expect(helpers.getPaymasterSignatureLength(hexConcat([hexZeroPad('0x', 53), '0x0002', PAYMASTER_SIG_MAGIC]))
        .catch(e => {
          throw new Error(decodeRevertReason(e.data)!)
        }))
        .to.be.rejectedWith('InvalidPaymasterSignatureLength(63,2)')
    })

    it('#paymasterDataKeccak', async () => {
      const suffix = '0x1122334455667788'
      expect(await helpers._calldataKeccakWithSuffix('0xabcdef', 2, suffix)).to
        .eql(keccak256(hexConcat(['0xabcd', suffix])))
    })

    it('#getPaymasterSignature', async () => {
      // getPaymasterSignature expects a valid pmSig length, as returned by getPaymasterSignatureLength
      expect(await helpers.getPaymasterSignatureWithLength('0x', 0)).to.equal('0x')
      await expect(helpers.getPaymasterSignatureWithLength('0x', 123)).revertedWith('')
    })
  })

  function createUserOp (overrides: Partial<UserOperation> = {}): UserOperation {
    return {
      ...defaultUserOp, ...overrides
    }
  }

  async function epGetUserOpHash (userOp: UserOperation): Promise<string> {
    return entryPoint.getUserOpHash(packUserOp(userOp, false))
  }

  describe('#getUserOpHash', () => {
    // check that helper getUserOpHash matches solidity implementation
    async function checkUserOpHash (userOp: UserOperation): Promise<void> {
      // console.log('packed=', packUserOp(userOp))
      expect(await epGetUserOpHash(userOp))
        .to.equal(getUserOpHash(userOp, entryPoint.address, chainId))
    }

    it('simpler userOp', async () => {
      await checkUserOpHash(createUserOp())
    })
    it('simpler userOp without paymaster', async () => {
      await checkUserOpHash(createUserOp({ paymaster: undefined }))
    })

    it('with valid pmSignature', async () => {
      await checkUserOpHash(createUserOp({ paymasterData: '0xcafe', paymasterSignature: '0x123456' }))
    })

    it('with invalid length pmSignature', async () => {
      // length is longer than actual data
      const pmSignatureLength = 200
      const pmSig = hexDataSlice(encodePaymasterSignature(hexZeroPad('0x', pmSignatureLength)), 180)
      // if pmSignature is broken, it is OK for getUserOpHash to revert...
      const userOp = createUserOp({ paymasterData: hexConcat(['0xcafe', pmSig]) })
      const dataLength = hexDataLength(packUserOp(userOp).paymasterAndData)
      await expect(checkUserOpHash(userOp).catch(e => {
        throw new Error(decodeRevertReason(e.data)!)
      })).to.rejectedWith(`InvalidPaymasterSignatureLength(${dataLength},${pmSignatureLength})`)
    })
  })

  it('appending paymasterSig to paymasterData should change userOpHash', async () => {
    expect(await epGetUserOpHash(createUserOp({
      paymasterData: '0xcafe'
    })
    )).to.not.eql(await epGetUserOpHash(createUserOp({
      paymasterData: '0xcafe', paymasterSignature: '0x1234'
    })
    ))
  })

  it('changing paymasterSig to paymasterData should not change userOpHash', async () => {
    expect(await epGetUserOpHash(createUserOp({
      paymasterData: '0xcafe', paymasterSignature: '0x1234'
    })
    )).to.eql(await epGetUserOpHash(createUserOp({
      paymasterData: '0xcafe', paymasterSignature: '0xabcdef'
    })
    ))
  })
})
