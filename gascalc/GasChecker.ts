// calculate gas usage of different bundle sizes
import '../test/aa.init'
import { formatEther, parseEther } from 'ethers/lib/utils'
import {
  AddressZero,
  checkForGeth,
  createAddress,
  createWalletOwner,
  deployEntryPoint
} from '../test/testutils'
import { EntryPoint, EntryPoint__factory, SimpleWallet__factory } from '../typechain'
import { BigNumberish, Wallet } from 'ethers'
import hre from 'hardhat'
import { fillAndSign } from '../test/UserOp'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import { table, TableUserConfig } from 'table'
import { Create2Factory } from '../src/Create2Factory'
import { hexValue } from '@ethersproject/bytes'
import * as fs from 'fs'
import { SimpleWalletInterface } from '../typechain/contracts/samples/SimpleWallet'

const gasCheckerLogFile = './reports/gas-checker.txt'

const ethers = hre.ethers
const provider = hre.ethers.provider
let ethersSigner = provider.getSigner()
let lastGasUsed: number

const minDepositOrBalance = parseEther('0.1')

const getBalance = hre.ethers.provider.getBalance

function range (n: number): number[] {
  return Array(n).fill(0).map((val, index) => index)
}

interface GasTestInfo {
  title: string
  diffLastGas: boolean
  paymaster: string
  count: number
  // address, or 'random' or 'self' (for wallet itself)
  dest: string
  destValue: BigNumberish
  destCallData: string
  beneficiary: string
  gasPrice: number
}

export const DefaultGasTestInfo: Partial<GasTestInfo> = {
  dest: 'self', // destination is the wallet itself.
  destValue: parseEther('0'),
  destCallData: '0xaffed0e0', // nonce()
  gasPrice: 10e9
}

interface GasTestResult {
  title: string
  count: number
  gasUsed: number // actual gas used
  walletEst: number // estimateGas of the inner transaction (from EP to wallet)
  gasDiff?: number // different from last test's gas used
  receipt?: TransactionReceipt
}

/**
 * singleton contract used by all GasChecker modules ("tests")
 * init() static method -
 *  - create the singleton the first time (or return its existing instance)
 *  run
 */

// gas estimate of the "execFromSingleton" methods
// we assume a given call signature has the same gas usage
// (TODO: the estimate also depends on contract code. for test purposes, assume each contract implementation has different method signature)
// at the end of the checks, we report the gas usage of all those method calls
const gasEstimatePerExec: { [key: string]: { title: string, walletEst: number } } = {}

/**
 * helper contract to generate gas test.
 * see runTest() method for "test template" info
 * override for different wallet implementation:
 * - walletInitCode() - the constructor code
 * - walletExec() the wallet execution method.
 */
export class GasChecker {
  wallets: { [wallet: string]: Wallet } = {}

  walletOwner: Wallet

  walletInterface: SimpleWalletInterface

  constructor () {
    this.walletOwner = createWalletOwner()
    this.walletInterface = SimpleWallet__factory.createInterface()
    void GasCheckCollector.init()
  }

  // generate the "exec" calldata for this wallet
  walletExec (dest: string, value: BigNumberish, data: string): string {
    return this.walletInterface.encodeFunctionData('execFromEntryPoint', [dest, value, data])
  }

  // generate the wallet "creation code"
  walletInitCode (): string {
    return hexValue(new SimpleWallet__factory(ethersSigner).getDeployTransaction(GasCheckCollector.inst.entryPoint.address, this.walletOwner.address).data!)
  }

  /**
   * create wallets up to this counter.
   * make sure they all have balance.
   * do nothing for wallet already created
   * @param count
   */
  async createWallets1 (count: number): Promise<void> {
    const fact = new Create2Factory(provider)
    // create wallets
    for (const n of range(count)) {
      const salt = n
      const initCode = this.walletInitCode()

      const addr = fact.getDeployedAddress(initCode, salt)
      this.wallets[addr] = this.walletOwner

      // deploy if not already deployed.
      await fact.deploy(initCode, salt, 2e6)
      const walletBalance = await GasCheckCollector.inst.entryPoint.balanceOf(addr)
      if (walletBalance.lte(minDepositOrBalance)) {
        await GasCheckCollector.inst.entryPoint.depositTo(addr, { value: minDepositOrBalance.mul(5) })
      }
    }
  }

  /**
   * helper: run a test scenario, and add a table row
   * @param params - test parameters. missing values filled in from DefaultGasTestInfo
   * note that 2 important params are methods: walletExec() and walletInitCode()
   */
  async addTestRow (params: Partial<GasTestInfo>): Promise<void> {
    await GasCheckCollector.init()
    GasCheckCollector.inst.addRow(await this.runTest(params))
  }

  /**
   * run a single test scenario
   * @param params - test parameters. missing values filled in from DefaultGasTestInfo
   * note that 2 important params are methods: walletExec() and walletInitCode()
   */
  async runTest (params: Partial<GasTestInfo>): Promise<GasTestResult> {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const info: GasTestInfo = { ...DefaultGasTestInfo, ...params } as GasTestInfo

    console.debug('== running test count=', info.count)

    // fill wallets up to this code.
    await this.createWallets1(info.count)

    let walletEst: number = 0
    const userOps = await Promise.all(range(info.count)
      .map(index => Object.entries(this.wallets)[index])
      .map(async ([wallet, walletOwner]) => {
        const paymaster = info.paymaster

        let { dest, destValue, destCallData } = info
        if (dest === 'self') {
          dest = wallet
        } else if (dest === 'random') {
          dest = createAddress()
          const destBalance = await getBalance(dest)
          if (destBalance.eq(0)) {
            console.log('dest replenish', dest)
            await ethersSigner.sendTransaction({ to: dest, value: 1 })
          }
        }
        const walletExecFromEntryPoint = this.walletExec(dest, destValue, destCallData)

        // remove the "dest" from the key to the saved estimations
        // so we have a single estimation per method.
        const estimateGasKey = this.walletExec(AddressZero, destValue, destCallData)

        let est = gasEstimatePerExec[estimateGasKey]
        // technically, each UserOp needs estimate - but we know they are all the same for each test.
        if (est == null) {
          const walletEst = (await ethers.provider.estimateGas({
            from: GasCheckCollector.inst.entryPoint.address,
            to: wallet,
            data: walletExecFromEntryPoint
          })).toNumber()
          est = gasEstimatePerExec[estimateGasKey] = { walletEst, title: info.title }
        }
        // console.debug('== wallet est=', walletEst.toString())
        walletEst = est.walletEst
        const op = await fillAndSign({
          sender: wallet,
          callData: walletExecFromEntryPoint,
          maxPriorityFeePerGas: info.gasPrice,
          maxFeePerGas: info.gasPrice,
          callGas: walletEst,
          verificationGas: 1000000,
          paymaster,
          preVerificationGas: 1
        }, walletOwner, GasCheckCollector.inst.entryPoint)
        // const packed = packUserOp(op, false)
        // console.log('== packed cost=', callDataCost(packed), packed)
        return op
      }))

    const txdata = GasCheckCollector.inst.entryPoint.interface.encodeFunctionData('handleOps', [userOps, info.beneficiary])
    console.log('=== encoded data=', txdata.length)
    const gasEst = await GasCheckCollector.inst.entryPoint.estimateGas.handleOps(
      userOps, info.beneficiary, {}
    )
    const ret = await GasCheckCollector.inst.entryPoint.handleOps(userOps, info.beneficiary, { gasLimit: gasEst.mul(3).div(2) })
    const rcpt = await ret.wait()
    const gasUsed = rcpt.gasUsed.toNumber()
    console.debug('count', info.count, 'gasUsed', gasUsed)
    const gasDiff = gasUsed - lastGasUsed
    if (info.diffLastGas) {
      console.debug('\tgas diff=', gasDiff)
    }
    lastGasUsed = gasUsed
    console.debug('handleOps tx.hash=', rcpt.transactionHash)
    const ret1: GasTestResult = {
      count: info.count,
      gasUsed,
      walletEst,
      title: info.title
      // receipt: rcpt
    }
    if (info.diffLastGas) { ret1.gasDiff = gasDiff }
    console.debug(ret1)
    return ret1
  }

  // helper methods to access the GasCheckCollector singleton
  addRow (res: GasTestResult): void {
    GasCheckCollector.inst.addRow(res)
  }

  entryPoint (): EntryPoint {
    return GasCheckCollector.inst.entryPoint
  }

  skipLong (): boolean {
    return process.env.SKIP_LONG != null
  }
}

export class GasCheckCollector {
  static inst: GasCheckCollector
  static initPromise?: Promise<GasCheckCollector>

  entryPoint: EntryPoint

  static async init (): Promise<void> {
    if (this.inst == null) {
      if (this.initPromise == null) {
        this.initPromise = new GasCheckCollector()._init()
      }
      this.inst = await this.initPromise
    }
  }

  async _init (entryPointAddressOrTest: string = 'test'): Promise<this> {
    console.log('signer=', await ethersSigner.getAddress())
    DefaultGasTestInfo.beneficiary = createAddress()

    const bal = await getBalance(ethersSigner.getAddress())
    if (bal.gt(parseEther('100000000'))) {
      console.log('bal=', formatEther(bal))
      console.log('DONT use geth miner.. use account 2 instead')
      await checkForGeth()
      ethersSigner = ethers.provider.getSigner(2)
    }

    if (entryPointAddressOrTest === 'test') {
      this.entryPoint = await deployEntryPoint(1, 1, provider)
    } else {
      this.entryPoint = EntryPoint__factory.connect(entryPointAddressOrTest, ethersSigner)
    }

    const tableHeaders = [
      'handleOps description         ',
      'count',
      'total gasUsed',
      'per UserOp gas\n(delta for\none UserOp)',
      // 'wallet.exec()\nestimateGas',
      'per UserOp overhead\n(compared to\nwallet.exec())'
    ]

    this.initTable(tableHeaders)
    return this
  }

  tableConfig: TableUserConfig
  tabRows: any[]

  /**
   * initialize our formatted table.
   * each header define the width of the column, so make sure to pad with spaces
   * (we stream the table, so can't learn the content length)
   */
  initTable (tableHeaders: string[]): void {
    console.log('inittable')

    // multiline header - check the length of the longest line.
    // function columnWidth (header: string): number {
    //   return Math.max(...header.split('\n').map(s => s.length))
    // }

    this.tableConfig = {
      columnDefault: { alignment: 'right' },
      columns: [{ alignment: 'left' }]
      // columns: tableHeaders.map((header, index) => ({
      //   alignment: index == 0 ? 'left' : 'right',
      //   width: columnWidth(header)
      // })),
      // columnCount: tableHeaders.length
    }
    this.tabRows = [tableHeaders]
  }

  doneTable (): void {
    fs.rmSync(gasCheckerLogFile, { force: true })
    const write = (s: string): void => {
      console.log(s)
      fs.appendFileSync(gasCheckerLogFile, s + '\n')
    }

    write('== gas estimate of direct calling the wallet\'s "execFromEntryPoint" method')
    write('   the destination is "wallet.nonce()", which is known to be "hot" address used by this wallet')
    write('   it little higher than EOA call: its an exec from entrypoint (or wallet owner) into wallet contract, verifying msg.sender and exec to target)')
    Object.values(gasEstimatePerExec).forEach(({ title, walletEst }) => {
      write(`- gas estimate "${title}" - ${walletEst}`)
    })

    const tableOutput = table(this.tabRows, this.tableConfig)
    write(tableOutput)
  }

  addRow (res: GasTestResult): void {
    const gasUsed = res.gasDiff != null ? '' : res.gasUsed // hide "total gasUsed" if there is a diff
    const perOp = res.gasDiff != null ? res.gasDiff - res.walletEst : ''

    this.tabRows.push([
      res.title,
      res.count,
      gasUsed,
      res.gasDiff ?? '',
      // res.walletEst,
      perOp])
  }
}

after(() => {
  GasCheckCollector.inst.doneTable()
})
