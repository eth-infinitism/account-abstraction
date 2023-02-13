import './aa.init'
import { BigNumber } from 'ethers'
import { AddressZero } from './testutils'
import { expect } from 'chai'
import { hexlify } from 'ethers/lib/utils'
import { TestHelpers, TestHelpers__factory } from '../typechain'
import { ethers } from 'hardhat'

const provider = ethers.provider
const ethersSigner = provider.getSigner()

describe('#ValidationData helpers', function () {
  function pack (addr: string, validUntil: number, validAfter: number): BigNumber {
    return BigNumber.from(BigNumber.from(addr))
      .add(BigNumber.from(validUntil).mul(BigNumber.from(2).pow(160)))
      .add(BigNumber.from(validAfter).mul(BigNumber.from(2).pow(160 + 48)))
  }

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
    expect(await helpers.parseValidationData(pack(AddressZero, 0, 10)))
      .to.eql({ aggregator: AddressZero, validAfter: 10, validUntil: max48 })
    expect(await helpers.parseValidationData(pack(AddressZero, 10, 0)))
      .to.eql({ aggregator: AddressZero, validAfter: 0, validUntil: 10 })
  })

  it('#packValidationData', async () => {
    expect(await helpers.packValidationData(false, 0, 0)).to.eql(0)
    expect(await helpers.packValidationData(true, 0, 0)).to.eql(1)
    expect(hexlify(await helpers.packValidationData(true, 123, 456)))
      .to.eql(hexlify(pack(addr1, 123, 456)))
  })

  it('#packValidationData with aggregator', async () => {
    expect(hexlify(await helpers.packValidationDataStruct({ aggregator: addr, validUntil: 234, validAfter: 567 })))
      .to.eql(hexlify(pack(addr, 234, 567)))
  })

  it('#intersectTimeRange', async () => {
    expect(await helpers.intersectTimeRange(pack(AddressZero, 0, 0), pack(AddressZero, 0, 0)))
      .to.eql({ aggregator: AddressZero, validAfter: 0, validUntil: max48 })
    expect(await helpers.intersectTimeRange(pack(AddressZero, 100, 10), pack(AddressZero, 200, 50)))
      .to.eql({ aggregator: AddressZero, validAfter: 50, validUntil: 100 })

    expect(await helpers.intersectTimeRange(pack(addr, 100, 10), pack(AddressZero, 200, 50)))
      .to.eql({ aggregator: addr, validAfter: 50, validUntil: 100 })
    expect(await helpers.intersectTimeRange(pack(addr, 100, 10), pack(addr1, 200, 50)))
      .to.eql({ aggregator: addr, validAfter: 50, validUntil: 100 })
    expect(await helpers.intersectTimeRange(pack(AddressZero, 100, 10), pack(addr1, 200, 50)))
      .to.eql({ aggregator: addr1, validAfter: 50, validUntil: 100 })
  })
})
