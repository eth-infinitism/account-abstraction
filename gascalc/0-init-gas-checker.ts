import {GasCheckCollector, GasChecker} from "./gasChecker";

describe('gas calculations', function () {
  this.timeout(20000)
  let g = new GasChecker()

  it('warmup', async function () {
    await GasCheckCollector.init()
    // dummy run - first run is slower.
    await g.runTest({title: 'simple', count: 1, diffLastGas: false})
  })
})



