import { GasCheckCollector, GasChecker } from './GasChecker'

context('simple account', function () {
  this.timeout(60000)
  const g = new GasChecker()

  before(async function () {
    await GasCheckCollector.init()
    GasCheckCollector.inst.createJsonResult = true
  })

  it('simple 1', async function () {
    await g.addTestRow({
      title: 'simple',
      count: 1,
      diffLastGas: false,
      dest: 'random',
      destValue: 1,
      destCallData: '0x',
      skipAccountCreation: true
    })
    await g.addTestRow({
      title: 'simple - diff',
      count: 2,
      diffLastGas: true,
      dest: 'random',
      destValue: 1,
      destCallData: '0x',
      skipAccountCreation: true
    })
  })

  it('simple-create 1', async function () {
    await g.addTestRow({
      title: 'simple-create',
      count: 1,
      diffLastGas: false,
      dest: 'random',
      destValue: 1,
      destCallData: '0x'
    })
    await g.addTestRow({
      title: 'simple-create - diff',
      count: 2,
      diffLastGas: true,
      dest: 'random',
      destValue: 1,
      destCallData: '0x'
    })
  })

  it.skip('simple 10', async function () {
    if (g.skipLong()) this.skip()
    await g.addTestRow({ title: 'simple', count: 10, diffLastGas: false })
    await g.addTestRow({ title: 'simple - diff from previous', count: 11, diffLastGas: true })
  })
})
