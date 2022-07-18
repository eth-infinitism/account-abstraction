import { DefaultGasTestInfo, GasChecker } from './GasChecker'

context('huge tx', function () {
  this.timeout(60000)
  const huge = DefaultGasTestInfo.destCallData!.padEnd(20480, 'f')
  const g = new GasChecker()

  it('big tx', async () => {
    await g.addTestRow({ title: 'big tx 10k', count: 1, destCallData: huge, diffLastGas: false })
    await g.addTestRow({ title: 'big tx - diff from previous', count: 2, destCallData: huge, diffLastGas: true })
  })
  it('big tx 20', async function () {
    if (g.skipLong()) this.skip()
    await g.addTestRow({ title: 'big tx', count: 20, destCallData: huge, diffLastGas: false })
    await g.addTestRow({ title: 'big tx - diff from previous', count: 21, destCallData: huge, diffLastGas: true })
  })
})
