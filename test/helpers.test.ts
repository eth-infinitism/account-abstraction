import './aa.init'
import { expect } from 'chai'
import { TestHelpers, TestHelpers__factory } from '../src/types'
import { ethers } from 'hardhat'
import { getBigInt, Signer, ZeroAddress } from 'ethers'

const provider = ethers.provider

describe('#ValidationData helpers', function () {
  let ethersSigner: Signer

  function pack (addr: string, validUntil: number, validAfter: number): bigint {
    return getBigInt(addr) +
      getBigInt(validUntil) * 2n << 160n +
      getBigInt(validAfter) * 2n << (160n + 48n)
  }

  let helpers: TestHelpers
  const addr1 = ZeroAddress.replace(/0$/, '1')
  const addr = '0x'.padEnd(42, '9')
  const max48 = 2 ** 48 - 1

  before(async () => {
    ethersSigner = await provider.getSigner()

    helpers = await new TestHelpers__factory(ethersSigner).deploy()
  })

  it('#parseValidationData', async () => {
    expect(await helpers.parseValidationData(0))
      .to.eql({ aggregator: ZeroAddress, validAfter: 0, validUntil: max48 })
    expect(await helpers.parseValidationData(1))
      .to.eql({ aggregator: addr1, validAfter: 0, validUntil: max48 })
    expect(await helpers.parseValidationData(pack(ZeroAddress, 0, 10)))
      .to.eql({ aggregator: ZeroAddress, validAfter: 10, validUntil: max48 })
    expect(await helpers.parseValidationData(pack(ZeroAddress, 10, 0)))
      .to.eql({ aggregator: ZeroAddress, validAfter: 0, validUntil: 10 })
  })

  it('#packValidationData', async () => {
    expect(await helpers.packValidationData(false, 0, 0)).to.eql(0)
    expect(await helpers.packValidationData(true, 0, 0)).to.eql(1)
    expect(await helpers.packValidationData(true, 123, 456))
      .to.eql(pack(addr1, 123, 456))
  })

  it('#packValidationData with aggregator', async () => {
    expect(await helpers.packValidationDataStruct({ aggregator: addr, validUntil: 234, validAfter: 567 }))
      .to.eql(pack(addr, 234, 567))
  })

  it('#intersectTimeRange', async () => {
    expect(await helpers.intersectTimeRange(pack(ZeroAddress, 0, 0), pack(ZeroAddress, 0, 0)))
      .to.eql({ aggregator: ZeroAddress, validAfter: 0, validUntil: max48 })
    expect(await helpers.intersectTimeRange(pack(ZeroAddress, 100, 10), pack(ZeroAddress, 200, 50)))
      .to.eql({ aggregator: ZeroAddress, validAfter: 50, validUntil: 100 })

    expect(await helpers.intersectTimeRange(pack(addr, 100, 10), pack(ZeroAddress, 200, 50)))
      .to.eql({ aggregator: addr, validAfter: 50, validUntil: 100 })
    expect(await helpers.intersectTimeRange(pack(addr, 100, 10), pack(addr1, 200, 50)))
      .to.eql({ aggregator: addr, validAfter: 50, validUntil: 100 })
    expect(await helpers.intersectTimeRange(pack(ZeroAddress, 100, 10), pack(addr1, 200, 50)))
      .to.eql({ aggregator: addr1, validAfter: 50, validUntil: 100 })
  })
})
