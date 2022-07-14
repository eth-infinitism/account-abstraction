import {GasCheckCollector, GasChecker} from "./gasChecker";

context('simple wallet', function () {
  this.timeout(20000)
  let g = new GasChecker()

  it('simple 1', async function () {
    await g.addTestRow({title: "simple", count: 1, diffLastGas: false})
    await g.addTestRow({title: 'simple - diff from previous', count: 2, diffLastGas: true})
  })

  it('simple 50', async function () {
    if (g.skipLong()) this.skip()
    await g.addTestRow({title: "simple", count: 50, diffLastGas: false})
    await g.addTestRow({title: 'simple - diff from previous', count: 51, diffLastGas: true})
  });
})
