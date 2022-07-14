import {GasChecker} from "./gasChecker";

context('huge tx', function () {
  this.timeout(20000)
  const huge = '0x'.padEnd(20480, 'f')
  let g = new GasChecker()

  it('big tx', async () => {
    await g.addTestRow({title: 'big tx', count: 1, destCallData: huge, diffLastGas: false})
    await g.addTestRow({title: 'big tx - diff from previous', count: 2, destCallData: huge, diffLastGas: true})
  });
  it('big tx 50', async function () {
    if (g.skipLong()) this.skip()
    await g.addTestRow({title: 'big tx', count: 50, destCallData: huge, diffLastGas: false})
    await g.addTestRow({title: 'big tx - diff from previous', count: 51, destCallData: huge, diffLastGas: true})
  });
})
