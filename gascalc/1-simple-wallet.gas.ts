import { GasChecker } from './GasChecker'

context('simple wallet', function () {
  this.timeout(60000)
  const g = new GasChecker()

  it('simple 1', async function () {
    await g.addTestRow({ title: 'simple', count: 1, diffLastGas: false })
    await g.addTestRow({ title: 'simple - diff from previous', count: 2, diffLastGas: true })
  })

  it('simple 10', async function () {
    if (g.skipLong()) this.skip()
    await g.addTestRow({ title: 'simple', count: 10, diffLastGas: false })
    await g.addTestRow({ title: 'simple - diff from previous', count: 11, diffLastGas: true })
  })
})
