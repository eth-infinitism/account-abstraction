import './aa.init'
import { AddressZero, packValidationData, parseValidationData } from './testutils'
import { expect } from 'chai'
import { hexlify } from 'ethers/lib/utils'
import { TestHelpers, TestHelpers__factory } from '../typechain'
import { ethers } from 'hardhat'

const provider = ethers.provider
const ethersSigner = provider.getSigner()

describe('#ValidationData helpers', function () {
  let helpers: TestHelpers
  const addr1 = AddressZero.replace(/0$/, '1')
  const addr = '0x'.padEnd(42, '9')
  const max48 = 2 ** 48 - 1

  before(async () => {
    helpers = await new TestHelpers__factory(ethersSigner).deploy()
  })

  it('#parseValidationData', async () => {
    expect(await helpers.parseValidationData(0))
      .to.eql({ aggregator: AddressZero, validAfter: 0, validUntil: max48 })
    expect(await helpers.parseValidationData(1))
      .to.eql({ aggregator: addr1, validAfter: 0, validUntil: max48 })
    expect(await helpers.parseValidationData(packValidationData({ aggregator: AddressZero, validUntil: 0, validAfter: 10 })))
      .to.eql({ aggregator: AddressZero, validAfter: 10, validUntil: max48 })
    expect(await helpers.parseValidationData(packValidationData({ aggregator: AddressZero, validUntil: 10, validAfter: 0 })))
      .to.eql({ aggregator: AddressZero, validAfter: 0, validUntil: 10 })
  })

  it('#parseValidationData (typescript)', async () => {
    expect(await helpers.parseValidationData(0))
      .to.eql(parseValidationData(0))
    expect(await helpers.parseValidationData(packValidationData({ aggregator: addr, validUntil: 10, validAfter: 0 })))
      .to.eql(parseValidationData(packValidationData({ aggregator: addr, validUntil: 10, validAfter: 0 })))
  })

  it('#packValidationData', async () => {
    expect(await helpers.packValidationData(false, 0, 0)).to.eql(0)
    expect(await helpers.packValidationData(true, 0, 0)).to.eql(1)
    expect(hexlify(await helpers.packValidationData(true, 123, 456)))
      .to.eql(hexlify(packValidationData({ aggregator: addr1, validUntil: 123, validAfter: 456 })))
  })

  it('#packValidationData with aggregator', async () => {
    expect(hexlify(await helpers.packValidationDataStruct({ aggregator: addr, validUntil: 234, validAfter: 567 })))
      .to.eql(hexlify(packValidationData({ aggregator: addr, validUntil: 234, validAfter: 567 })))
  })

  it('#packValidationDataBlockRange', async () => {
    const FLAG = '0x800000000000'
    const MASK = 0x7fffffffffff
    const extract = (packed: any, shift: number) =>
      ethers.BigNumber.from(packed).shr(shift).and(0xffffffffffff).toHexString()

    // both bounds must carry the flag, even when a bound is 0 ("no bound") —
    // an unflagged bound silently degrades the whole range to timestamp semantics
    const packed = await helpers.packValidationDataBlockRange(false, 1000, 0)
    expect(extract(packed, 160)).to.eql(ethers.BigNumber.from(FLAG).or(1000).toHexString())
    expect(extract(packed, 208)).to.eql(FLAG)

    // sigFailed flag is preserved
    const packedFailed = await helpers.packValidationDataBlockRange(true, 1000, 0)
    expect(ethers.BigNumber.from(packedFailed).and(1)).to.eql(1)

    // 0 deadline maps to an open-ended block range, mirroring the timestamp convention
    const packedOpen = await helpers.packValidationDataBlockRange(false, 0, 5)
    expect(extract(packedOpen, 160)).to.eql(ethers.BigNumber.from(FLAG).or(MASK).toHexString())
  })
})
