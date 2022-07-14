// calculate gas usage of different bundle sizes
import '../test/aa.init'
import {formatEther, parseEther} from "ethers/lib/utils";
import {
  AddressZero,
  checkForGeth,
  createAddress,
  createWalletOwner,
  deployEntryPoint,
  isDeployed
} from "../test/testutils";
import {
  EntryPoint,
  EntryPoint__factory,
  SimpleWallet__factory,
} from "../typechain";
import {BigNumberish, Wallet} from "ethers";
import hre from 'hardhat'
import {fillAndSign} from "../test/UserOp";
import {SimpleWalletInterface} from "../typechain/SimpleWallet";
import 'colors'
import {UserOperation} from "../test/UserOperation";
import {TransactionReceipt} from "@ethersproject/abstract-provider";
import {table, TableUserConfig} from 'table'
import {Create2Factory} from "../src/Create2Factory";
import {hexValue} from "@ethersproject/bytes";
import * as fs from "fs";

const gasCheckerLogFile = './reports/gas-checker.txt'

const ethers = hre.ethers
const provider = hre.ethers.provider
let ethersSigner = provider.getSigner()
let lastGasUsed: number

const minDepositOrBalance = parseEther('0.1')

const getBalance = hre.ethers.provider.getBalance

function range(n: number): number[] {
  return Array(n).fill(0).map((val, index) => index)
}

interface GasTestInfo {
  title: string
  diffLastGas: boolean
  paymaster: string
  count: number
  dest: string
  destValue: BigNumberish
  destCallData: string
  beneficiary: string
  gasPrice: number
}

const DefaultGasTestInfo: Partial<GasTestInfo> = {
  dest: AddressZero,
  destValue: parseEther('0'),
  destCallData: '0x',
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

interface Table {
  addTableRow: (args: Array<any>) => void
  doneTable: () => void
}


/**
 * singleton contract used by all GasChecker modules ("tests")
 * init() static method -
 *  - create the singleton the first time (or return its existing instance)
 *  run
 */

var gasCheckerInstance: any = null

export class GasChecker {

  wallets: { [wallet: string]: Wallet } = {}

  gasCheckEntryPoint: EntryPoint
  walletOwner: Wallet

  gasEstimatePerExec: { [key: string]: { title: string, walletEst: number } } = {}


  saveConsoleLog: any = null
  walletInterface: SimpleWalletInterface

  redirectConsoleLogToFile(outputFile: string) {
    fs.rmSync(outputFile, {force: true})
    console.log('Writing output to', outputFile)

    //revert previous redirect if already exist
    if (this.saveConsoleLog) {
      console.log = this.saveConsoleLog
    }

    this.saveConsoleLog = console.log
    console.log = (msg) => {
      this.saveConsoleLog(msg)
      fs.appendFileSync(outputFile, msg + '\n')
    }
  }

  async _init(entryPointAddressOrTest: string = 'test') {
    console.log('signer=', await ethersSigner.getAddress())
    DefaultGasTestInfo.beneficiary = createAddress()

    let bal = await getBalance(ethersSigner.getAddress());
    if (bal.gt(parseEther('100000000'))) {
      console.log('bal=', formatEther(bal))
      console.log('DONT use geth miner.. use account 2 instead')
      await checkForGeth()
      ethersSigner = ethers.provider.getSigner(2)
    }

    if (entryPointAddressOrTest == 'test') {
      this.gasCheckEntryPoint = await deployEntryPoint(1, 1, provider)
    } else {
      this.gasCheckEntryPoint = EntryPoint__factory.connect(entryPointAddressOrTest, ethersSigner)
    }
    this.walletOwner = createWalletOwner()

    this.walletInterface = SimpleWallet__factory.createInterface()
  }

  /**
   * create wallets up to this counter.
   * make sure they all have balance.
   * do nothing for wallet already created
   * @param count
   */
  async createWallets1(count: number, entryPoint: EntryPoint) {
    const simpleWalletFactory = new SimpleWallet__factory(ethersSigner)
    const fact = new Create2Factory(provider)
    //create wallets
    for (let n in range(count)) {
      const salt = parseInt(n)
      const initCode = hexValue(await simpleWalletFactory.getDeployTransaction(entryPoint.address, this.walletOwner.address).data!)

      const addr = fact.getDeployedAddress(initCode, salt)
      this.wallets[addr] = this.walletOwner

      //deploy if not already deployed.
      await fact.deploy(initCode, salt)
      let walletBalance = await entryPoint.balanceOf(addr);
      if (walletBalance.lte(minDepositOrBalance)) {
        await entryPoint.depositTo(addr, {value: minDepositOrBalance.mul(5)})
      }
    }
  }

  // must be FALSE for automining (hardhat), otherwise "true"
  useAutoNonce = false


//create userOp to create multiple wallets.  this is quite slow on Hardhat/ganache nodes,
// so we create the wallets in separate transactions
  async createWalletsWithUserOps(count: number) {
    const constructorCode = new SimpleWallet__factory(ethersSigner).getDeployTransaction(this.gasCheckEntryPoint.address, this.walletOwner.address).data!

    let nonce = await provider.getTransactionCount(ethersSigner.getAddress())

    const pThis = this

    function autoNonce() {
      if (pThis.useAutoNonce) {
        return nonce++
      } else {
        return undefined
      }
    }

    const ops1 = await Promise.all(range(count).map(async index => {
      const addr = await this.gasCheckEntryPoint.getSenderAddress(constructorCode, index)
      this.wallets[addr] = this.walletOwner
      if (await isDeployed(addr)) {
        // console.log('== wallet', addr, 'already deployed'.yellow)
        return
      }

      return fillAndSign({
        sender: addr,
        initCode: constructorCode,
        nonce: index
      }, this.walletOwner, this.gasCheckEntryPoint)
    }))

    const userOps = ops1.filter(x => x != undefined) as UserOperation[]
    //deposit balance for deployment (todo: excelent place to use a paymaster...)
    for (let op of userOps) {
      let addr = op.sender;
      let walletBalance = await this.gasCheckEntryPoint.balanceOf(addr);
      if (walletBalance.lte(minDepositOrBalance)) {
        // console.debug('== wallet', addr, 'depositing for create'.yellow)
        await this.gasCheckEntryPoint.depositTo(addr, {value: minDepositOrBalance.mul(5)})
      }
    }

    if (userOps.length > 0) {
      console.log('createWallets: handleOps')
      const ret = await this.gasCheckEntryPoint.handleOps(userOps, DefaultGasTestInfo.beneficiary!)
      const rcpt = await ret.wait()
      console.log('deployment'.green, 'of', userOps.length, 'wallets, gas cost=', rcpt.gasUsed.toNumber())
    } else {
      console.log('all', count, 'wallets already deployed'.yellow)
    }
  }

  /**
   * run a single gas calculation test, to calculate
   * @param params - test parameters. missing values filled in from DefaultGasTestInfo
   */
  async runTest(params: Partial<GasTestInfo>): Promise<GasTestResult> {
    const info = {...DefaultGasTestInfo, ...params} as GasTestInfo

    console.debug('== running test count=', info.count)

    await this.createWallets1(info.count, this.gasCheckEntryPoint)

    let walletEst: number = 0
    const userOps = await Promise.all(range(info.count)
      .map(index => Object.entries(this.wallets)[index])
      .map(async ([wallet, walletOwner]) => {

        let paymaster = info.paymaster

        let {dest, destValue, destCallData} = info
        if (dest == null) {
          dest = createAddress()
        }
        const walletExecFromEntryPoint = this.walletInterface.encodeFunctionData('execFromEntryPoint',
          [dest, destValue, destCallData])

        let est = this.gasEstimatePerExec[walletExecFromEntryPoint]
        //technically, each UserOp needs estimate - but we know they are all the same for each test.
        if (est == null) {
          walletEst = (await ethers.provider.estimateGas({
            from: this.gasCheckEntryPoint.address,
            to: wallet,
            data: walletExecFromEntryPoint
          })).toNumber()
          this.gasEstimatePerExec[walletExecFromEntryPoint] = {walletEst, title: info.title}
        } else {
          walletEst = est.walletEst
        }
        // console.debug('== wallet est=', walletEst.toString())
        const op = await fillAndSign({
          sender: wallet,
          callData: walletExecFromEntryPoint,
          maxPriorityFeePerGas: info.gasPrice,
          maxFeePerGas: info.gasPrice,
          callGas: walletEst,
          verificationGas: 1000000,
          paymaster,
          preVerificationGas: 1
        }, walletOwner, this.gasCheckEntryPoint)
        // const packed = packUserOp(op, false)
        // console.log('== packed cost=', callDataCost(packed), packed)
        return op
      }))

    const ret = await this.gasCheckEntryPoint.handleOps(userOps, info.beneficiary, {gasLimit: 20e6})
    const rcpt = await ret.wait()
    let gasUsed = rcpt.gasUsed.toNumber()
    console.debug('count', info.count, 'gasUsed', gasUsed)
    let gasDiff = gasUsed - lastGasUsed;
    if (info.diffLastGas) {
      console.debug('\tgas diff=', gasDiff)
    }
    lastGasUsed = gasUsed
    console.debug('handleOps tx.hash=', rcpt.transactionHash.yellow)
    let ret1: GasTestResult = {
      count: info.count,
      gasUsed,
      walletEst,
      title: info.title
      // receipt: rcpt
    }
    if (info.diffLastGas)
      ret1.gasDiff = gasDiff
    console.debug(ret1)
    return ret1
  }

  tableConfig: TableUserConfig
  tabRows: any[]

  /**
   * initialize our formatted table.
   * each header define the width of the column, so make sure to pad with spaces
   * (we stream the table, so can't learn the content length)
   */
  initTable(tableHeaders: string[]) {

    console.log('inittable')
    //multiline header - check the length of the longest line.
    function columnWidth(header: string) {
      return Math.max(...header.split('\n').map(s => s.length))
    }

    this.tableConfig = {
      columnDefault: {alignment: 'right'},
      columns: [{alignment: 'left'}]
      // columns: tableHeaders.map((header, index) => ({
      //   alignment: index == 0 ? 'left' : 'right',
      //   width: columnWidth(header)
      // })),
      // columnCount: tableHeaders.length
    };
    this.tabRows = [tableHeaders]
  }

  doneTable() {
    const write = (s: string) => {
      console.log(s)
      fs.appendFileSync(gasCheckerLogFile, s + '\n')
    }

    write('== gas estimate of direct calling wallet.exec()')
    write('   (estimate the cost of calling directly the "wallet.execFromEntrypoint(dest,calldata)" )')
    Object.values(this.gasEstimatePerExec).forEach(({title, walletEst}) => {
      write(`- gas estimate "${title}" - ${walletEst}`)
    })

    const tableOutput = table(this.tabRows, this.tableConfig);
    write(tableOutput)
  }

  addRow(res: GasTestResult) {

    let gasUsed = res.gasDiff ? '' : res.gasUsed; //hide "total gasUsed" if there is a diff
    const perOp = res.gasDiff ? res.gasDiff - res.walletEst : ''

    this.tabRows.push([
      res.title,
      res.count,
      gasUsed,
      res.gasDiff ?? '',
      // res.walletEst,
      perOp])
  }


  static async init(): Promise<GasChecker> {
    if (gasCheckerInstance == null) {
      gasCheckerInstance = new GasChecker()
      await gasCheckerInstance.initGasChecker()
    }
    return gasCheckerInstance
  }

  async initGasChecker() {
    await this._init()

    const tableHeaders = [
      'handleOps description         ',
      'count',
      'total gasUsed',
      'per UserOp gas\n(delta for one UserOp)',
      // 'wallet.exec()\nestimateGas',
      'per UserOp overhead\n(compared to wallet.exec())',
    ]

    this.initTable(tableHeaders)
    process.on('exit', () => this.doneTable())
  }

  skipLong() {
    return true
  }

}
