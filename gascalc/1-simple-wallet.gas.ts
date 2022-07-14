import {addRow, runTest} from "./gasChecker";

context('simple wallet', function () {
  this.timeout(20000)
  it('simple 1', async function () {
    addRow(await runTest({title: "simple", count: 1, diffLastGas: false}))
    addRow(await runTest({title: 'simple - diff from previous', count: 2, diffLastGas: true}))
  })

  it('simple 50', async function () {
    addRow(await runTest({title: "simple", count: 50, diffLastGas: false}))
    addRow(await runTest({title: 'simple - diff from previous', count: 51, diffLastGas: true}))
  });
})
