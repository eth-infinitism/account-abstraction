import {addRow, runTest} from "./gasChecker";

context('huge tx', function () {
  this.timeout(20000)
  const huge = '0x'.padEnd(20480, 'f')

  it('big tx', async () => {
    addRow(await runTest({title: 'big tx', count: 1, destCallData: huge, diffLastGas: false}))
    addRow(await runTest({title: 'big tx - diff from previous', count: 2, destCallData: huge, diffLastGas: true}))
  });
  it('big tx 50', async () => {
    addRow(await runTest({title: 'big tx', count: 50, destCallData: huge, diffLastGas: false}))
    addRow(await runTest({title: 'big tx - diff from previous', count: 51, destCallData: huge, diffLastGas: true}))
  });
})
