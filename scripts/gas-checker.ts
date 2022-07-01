// calculate gas usage of different bundle sizes
import '../test/aa.init'
import {formatEther, parseEther} from "ethers/lib/utils";
import {AddressZero, checkForGeth, createAddress, createWalletOwner, deployEntryPoint} from "../test/testutils";
import {
  EntryPoint,
  EntryPoint__factory,
  SimpleWallet__factory,
  TestPaymasterAcceptAll__factory
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
import {boolean} from "hardhat/internal/core/params/argumentTypes";

const ethers = hre.ethers
const provider = hre.ethers.provider
let ethersSigner = provider.getSigner()
let lastGasUsed: number

const minDepositOrBalance = parseEther('0.1')

const getBalance = hre.ethers.provider.getBalance

function range(n: number): number[] {
  return Array(n).fill(0).map((val, index) => index)
}

let walletInterface: SimpleWalletInterface
let wallets: { [wallet: string]: Wallet } = {}
let entryPoint: EntryPoint
let walletOwner: Wallet

let paymasterAddress: string
let gasEstimatePerExec: { [key: string]: { title: string, walletEst: number } } = {}

interface TestInfo {
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

const DefaultInfo: Partial<TestInfo> = {
  dest: AddressZero,
  destValue: parseEther('0'),
  destCallData: '0x',
  gasPrice: 10e9
}

function writeLogToFile() {
  const outputFile = './reports/gas-checker.txt'
  fs.rmSync(outputFile, {force: true})
  console.log('Writing output to', outputFile)

  const saveLog = console.log
  console.log = function (msg) {
    saveLog(msg)
    fs.appendFileSync(outputFile, msg + '\n')
  }
}

async function init(entryPointAddressOrTest: string = 'test') {
  // await checkForGeth()

  console.log('signer=', await ethersSigner.getAddress())
  DefaultInfo.beneficiary = createAddress()

  let bal = await getBalance(ethersSigner.getAddress());
  if (bal.gt(parseEther('100000000'))) {
    console.log('bal=', formatEther(bal))
    console.log('DONT use geth miner.. use account 2 instead')
    await checkForGeth()
    ethersSigner = ethers.provider.getSigner(2)
  }

  if (entryPointAddressOrTest == 'test') {
    entryPoint = await deployEntryPoint(1, 1, provider)
  } else {
    entryPoint = EntryPoint__factory.connect(entryPointAddressOrTest, ethersSigner)
  }
  walletOwner = createWalletOwner()

  walletInterface = SimpleWallet__factory.createInterface()
  const paymaster = await new TestPaymasterAcceptAll__factory(ethersSigner).deploy(entryPoint.address)
  paymasterAddress = paymaster.address
  await paymaster.addStake(0, {value: 1})
  await entryPoint.depositTo(paymaster.address, {value: parseEther('10')})
}

/**
 * create wallets up to this counter.
 * make sure they all have balance.
 * do nothing for wallet already created
 * @param count
 */
async function createWallets1(count: number, entryPoint: EntryPoint) {
  const simpleWalletFactory = new SimpleWallet__factory(ethersSigner)
  const fact = new Create2Factory(provider)
  //create wallets
  for (let n in range(count)) {
    const salt = parseInt(n)
    const initCode = hexValue(await simpleWalletFactory.getDeployTransaction(entryPoint.address, walletOwner.address).data!)

    const addr = fact.getDeployedAddress(initCode, salt)
    wallets[addr] = walletOwner

    //deploy if not already deployed.
    await fact.deploy(initCode, salt)
    let walletBalance = await entryPoint.balanceOf(addr);
    if (walletBalance.lte(minDepositOrBalance)) {
      await entryPoint.depositTo(addr, {value: minDepositOrBalance.mul(5)})
    }
  }
}

async function isDeployed(addr: string) {
  const code = await ethers.provider.getCode(addr)
  return code.length > 2
}

//must be FALSE for automining (hardhat), otherwise "true"
let useAutoNonce = false


//create userOp to create multiple wallets.  this is quite slow on Hardhat/ganache nodes,
// so we create the wallets in separate transactions
async function createWalletsWithUserOps(count: number) {
  const constructorCode = new SimpleWallet__factory().getDeployTransaction(entryPoint.address, walletOwner.address).data!

  let nonce = await provider.getTransactionCount(ethersSigner.getAddress())

  function autoNonce() {
    if (useAutoNonce) {
      return nonce++
    } else {
      return undefined
    }
  }

  const ops1 = await Promise.all(range(count).map(async index => {
    const addr = await entryPoint.getSenderAddress(constructorCode, index)
    wallets[addr] = walletOwner
    if (await isDeployed(addr)) {
      // console.log('== wallet', addr, 'already deployed'.yellow)
      return
    }

    return fillAndSign({
      sender: addr,
      initCode: constructorCode,
      nonce: index
    }, walletOwner, entryPoint)
  }))

  const userOps = ops1.filter(x => x != undefined) as UserOperation[]
  //deposit balance for deployment (todo: excelent place to use a paymaster...)
  for (let op of userOps) {
    let addr = op.sender;
    let walletBalance = await entryPoint.balanceOf(addr);
    if (walletBalance.lte(minDepositOrBalance)) {
      // console.debug('== wallet', addr, 'depositing for create'.yellow)
      await entryPoint.depositTo(addr, {value: minDepositOrBalance.mul(5)})
    }
  }

  if (userOps.length > 0) {
    console.log('createWallets: handleOps')
    const ret = await entryPoint.handleOps(userOps, DefaultInfo.beneficiary!)
    const rcpt = await ret.wait()
    console.log('deployment'.green, 'of', userOps.length, 'wallets, gas cost=', rcpt.gasUsed.toNumber())
  } else {
    console.log('all', count, 'wallets already deployed'.yellow)
  }
}

interface TestResult {
  title: string
  count: number
  gasUsed: number // actual gas used
  walletEst: number // estimateGas of the inner transaction (from EP to wallet)
  gasDiff?: number // different from last test's gas used
  receipt?: TransactionReceipt
}

//run a single test, with that many columns
async function runTest(params: Partial<TestInfo>): Promise<TestResult> {
  const info = {...DefaultInfo, ...params} as TestInfo
  console.debug('== running test count=', info.count)
  //we send transaction sin parallel: must manage nonce manually.
  let nonce = await provider.getTransactionCount(ethersSigner.getAddress())

  await createWallets1(info.count, entryPoint)

  if (info.count > Object.keys(wallets).length) {
    //TODO: maybe create more just here?
    throw new Error(`count=${info.count}, but has only ${wallets.length} wallets.`)
  }
  let walletEst: number = 0
  const userOps = await Promise.all(range(info.count)
    .map(index => Object.entries(wallets)[index])
    .map(async ([wallet, walletOwner]) => {

      let paymaster = info.paymaster

      let {dest, destValue, destCallData} = info
      if (dest == null) {
        dest = createAddress()
      }
      const walletExecFromEntryPoint = walletInterface.encodeFunctionData('execFromEntryPoint',
        [dest, destValue, destCallData])

      let est = gasEstimatePerExec[walletExecFromEntryPoint]
      //technically, each UserOp needs estimate - but we know they are all the same for each test.
      if (est == null) {
        walletEst = (await ethers.provider.estimateGas({
          from: entryPoint.address,
          to: wallet,
          data: walletExecFromEntryPoint
        })).toNumber()
        gasEstimatePerExec[walletExecFromEntryPoint] = {walletEst, title: info.title}
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
      }, walletOwner, entryPoint)
      // const packed = packUserOp(op, false)
      // console.log('== packed cost=', callDataCost(packed), packed)
      return op
    }))

  const ret = await entryPoint.handleOps(userOps, info.beneficiary, {gasLimit: 20e6})
  const rcpt = await ret.wait()
  let gasUsed = rcpt.gasUsed.toNumber()
  console.debug('count', info.count, 'gasUsed', gasUsed)
  let gasDiff = gasUsed - lastGasUsed;
  if (info.diffLastGas) {
    console.debug('\tgas diff=', gasDiff)
  }
  lastGasUsed = gasUsed
  console.debug('handleOps tx.hash=', rcpt.transactionHash.yellow)
  let ret1: TestResult = {
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

interface Table {
  addTableRow: (args: Array<any>) => void
  doneTable: () => void
}

/**
 * initialize our formatted table.
 * each header define the width of the column, so make sure to pad with spaces
 * (we stream the table, so can't learn the content length)
 */
function initTable(tableHeaders: string[]): Table {

  //multiline header - check the length of the longest line.
  function columnWidth(header: string) {
    return Math.max(...header.split('\n').map(s => s.length))
  }

  const tableConfig: TableUserConfig = {
    columnDefault: {alignment: 'right'},
    columns: [{alignment: 'left'}]
    // columns: tableHeaders.map((header, index) => ({
    //   alignment: index == 0 ? 'left' : 'right',
    //   width: columnWidth(header)
    // })),
    // columnCount: tableHeaders.length
  };

  let tab: any[] = [tableHeaders]

  return {
    addTableRow: (arr: any[]) => {
      tab.push(arr)
    },
    doneTable: () => {
      let tableOutput = table(tab, tableConfig);
      console.log(tableOutput)
    }
  }
}

async function runGasCalcs() {
  await init()

  const tableHeaders = [
    'handleOps description         ',
    'count',
    'total gasUsed',
    'per UserOp gas\n(delta for one UserOp)',
    // 'wallet.exec()\nestimateGas',
    'per UserOp overhead\n(compared to wallet.exec())',
  ]

  const {addTableRow, doneTable} = initTable(tableHeaders)

  function addRow(res: TestResult) {

    process.stdout.write('.')
    let gasUsed = res.gasDiff ? '' : res.gasUsed; //hide "total gasUsed" if there is a diff
    const perOp = res.gasDiff ? res.gasDiff - res.walletEst : ''
    addTableRow([
      res.title,
      res.count,
      gasUsed,
      res.gasDiff ?? '',
      // res.walletEst,
      perOp])
  }

  // console.debug = () => {
  // }

  //dummy run - first run is slower.
  await runTest({title: 'simple', count: 1, diffLastGas: false})
  addRow(await runTest({title: "simple", count: 1, diffLastGas: false}))
  addRow(await runTest({title: 'simple - diff from previous', count: 2, diffLastGas: true}))

  addRow(await runTest({title: "simple", count: 50, diffLastGas: false}))
  addRow(await runTest({title: 'simple - diff from previous', count: 51, diffLastGas: true}))

  addRow(await runTest({title: "simple paymaster", count: 1, paymaster: paymasterAddress, diffLastGas: false}))
  addRow(await runTest({title: "simple paymaster with diff", count: 2, paymaster: paymasterAddress, diffLastGas: true}))

  addRow(await runTest({title: "simple paymaster", count: 50, paymaster: paymasterAddress, diffLastGas: false}))
  addRow(await runTest({
    title: "simple paymaster with diff",
    count: 51,
    paymaster: paymasterAddress,
    diffLastGas: true
  }))


  const huge = '0x'.padEnd(20480, 'f')

  addRow(await runTest({title: 'big tx', count: 1, destCallData: huge, diffLastGas: false}))
  addRow(await runTest({title: 'big tx - diff from previous', count: 2, destCallData: huge, diffLastGas: true}))

  addRow(await runTest({title: 'big tx', count: 50, destCallData: huge, diffLastGas: false}))
  addRow(await runTest({title: 'big tx - diff from previous', count: 51, destCallData: huge, diffLastGas: true}))

  writeLogToFile()

  console.log('== gas estimate of direct calling wallet.exec()')
  console.log('   (estimate the cost of calling directly the "wallet.execFromEntrypoint(dest,calldata)" )')
  Object.values(gasEstimatePerExec).forEach(({title, walletEst}) => {
    console.log(`- gas estimate "${title}" - ${walletEst}`)
  })
  doneTable()
  return
}

runGasCalcs()
  .then(() => process.exit(0))
  .catch(err => {
    console.log(err)
    process.exit(1)
  })
