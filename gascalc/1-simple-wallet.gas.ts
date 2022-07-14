import {GasChecker} from "./gasChecker";

context('simple wallet', function () {
  this.timeout(20000)
  let g: GasChecker

  before(async function () {
    g = await GasChecker.init()
  })

  it('simple 1', async function () {
    g.addRow(await g.runTest({title: "simple", count: 1, diffLastGas: false}))
    g.addRow(await g.runTest({title: 'simple - diff from previous', count: 2, diffLastGas: true}))
  })

  it('simple 50', async function () {
    if (g.skipLong()) this.skip()
    g.addRow(await g.runTest({title: "simple", count: 50, diffLastGas: false}))
    g.addRow(await g.runTest({title: 'simple - diff from previous', count: 51, diffLastGas: true}))
  });
})
