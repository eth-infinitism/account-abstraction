import { GasCheckCollector, GasChecker } from './GasChecker'

describe('gas calculations', function () {
  this.timeout(60000)
  const g = new GasChecker()

  it('warmup', async function () {
    await GasCheckCollector.init()
    // dummy run - first run is slower.
    await g.runTest({ title: 'simple', count: 1, diffLastGas: false })
  })
})
