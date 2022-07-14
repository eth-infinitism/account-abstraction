import {GasChecker} from "./gasChecker";

describe('gas calculations', function () {
  this.timeout(20000)
  let g: GasChecker

  before(async function () {
    g = await GasChecker.init()
  })

  it('warmup', async function () {
    // dummy run - first run is slower.
    await g.runTest({title: 'simple', count: 1, diffLastGas: false})
  })


})



