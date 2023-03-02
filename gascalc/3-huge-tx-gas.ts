import { DefaultGasTestInfo, GasChecker } from './GasChecker'

context('huge tx - 5k', function () {
  this.timeout(60000)
  const huge = DefaultGasTestInfo.destCallData!.padEnd(10240, 'f')
  const g = new GasChecker()

  it('big tx 5k', async () => {
    await g.addTestRow({ title: 'big tx 5k', count: 1, destCallData: huge, diffLastGas: false })
    await g.addTestRow({ title: 'big tx - diff from previous', count: 2, destCallData: huge, diffLastGas: true })
  })
  it('big tx 10', async function () {
    if (g.skipLong()) this.skip()
    await g.addTestRow({ title: 'big tx 5k', count: 10, destCallData: huge, diffLastGas: false })
    await g.addTestRow({ title: 'big tx - diff from previous', count: 11, destCallData: huge, diffLastGas: true })
  })
})
