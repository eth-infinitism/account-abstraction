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
})
