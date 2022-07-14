import {initGasChecker, runTest} from "./gasChecker";

describe('gas calculations', function () {
  this.timeout(20000)

  before(async function () {
    await initGasChecker();

  })
  it('warmup', async function () {
    // dummy run - first run is slower.
    await runTest({title: 'simple', count: 1, diffLastGas: false})
  })


})



