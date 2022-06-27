// calculate gas usage of different bundle sizes
import '../test/aa.init'
import {formatEther, parseEther} from "ethers/lib/utils";
import {AddressZero, checkForGeth, createAddress, createWalletOwner, deployEntryPoint} from "../test/testutils";
import {EntryPoint, EntryPoint__factory, SimpleWallet__factory} from "../typechain";
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

enum PaymentMethod { WalletBalance, WalletDeposit, Paymaster}

interface TestInfo {
  diffLastGas: boolean;
  payment: PaymentMethod,
  count: number
  dest: string
  destValue: BigNumberish
  destCallData: string
  beneficiary: string
  gasPrice: number
}

const DefaultInfo: Partial<TestInfo> = {
  payment: PaymentMethod.WalletDeposit,
  dest: AddressZero,
  destValue: parseEther('0'),
  destCallData: '0x',
  gasPrice: 10e9
}

async function init(entryPointAddress: string = 'test') {
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

  if (entryPointAddress == 'test') {
    entryPoint = await deployEntryPoint(1, 1, provider)
  } else {
    entryPoint = EntryPoint__factory.connect(entryPointAddress, ethersSigner)
  }
  walletOwner = createWalletOwner()

  walletInterface = SimpleWallet__factory.createInterface()
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
      switch (info.payment) {
        case PaymentMethod.WalletDeposit:
          if ((await entryPoint.balanceOf(wallet)).lte(minDepositOrBalance)) {
            console.log('== deposit to wallet', wallet)
            await entryPoint.depositTo(wallet, {nonce: nonce++, value: minDepositOrBalance.mul(5)})
          }
          break
        case PaymentMethod.WalletBalance:
          if ((await getBalance(wallet)).lte(minDepositOrBalance)) {
            console.debug('== send balance to wallet', wallet)
            await ethersSigner.sendTransaction({nonce: nonce++, to: wallet, value: minDepositOrBalance.mul(5)})
          }
          break
        case PaymentMethod.Paymaster:
          throw new Error('=== paymaster mode not yet ready')
      }
      const walletExecFromEntryPoint = walletInterface.encodeFunctionData('execFromEntryPoint',
        [info.dest, info.destValue, info.destCallData])
      //technically, each UserOp needs estimate - but we know they are all the same for each test.
      if (walletEst == 0) {
        walletEst = (await ethers.provider.estimateGas({
          from: entryPoint.address,
          to: wallet,
          data: walletExecFromEntryPoint
        })).toNumber()
      }
      // console.debug('== wallet est=', walletEst.toString())
      const op = await fillAndSign({
        sender: wallet,
        callData: walletExecFromEntryPoint,
        maxPriorityFeePerGas: info.gasPrice,
        maxFeePerGas: info.gasPrice,
        callGas: walletEst,
        verificationGas: 1000000,
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
      const outputFile = './reports/gas-checker.txt'
      let tableOutput = table(tab, tableConfig);
      fs.writeFileSync(outputFile, tableOutput)
      console.log('Writing table to', outputFile)
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
    'wallet.exec()\nestimateGas',
    'per UserOp overhead\n(compared to wallet.exec())']

  const {addTableRow, doneTable} = initTable(tableHeaders)

  function addRow(title: string, res: TestResult) {
    let gasUsed = res.gasDiff ? '' : res.gasUsed; //hide "total gasUsed" if there is a diff
    const perOp = res.gasDiff ? res.gasDiff - res.walletEst : ''
    addTableRow([title, res.count, gasUsed, res.gasDiff ?? '', res.walletEst, perOp])
  }

  console.debug = () => {
  }

  //dummy run - first run is slower.
  await runTest({count: 1, diffLastGas: false})
  addRow("simple", await runTest({count: 1, diffLastGas: false}))
  addRow('simple - diff from previous', await runTest({count: 2, diffLastGas: true}))

  addRow("simple", await runTest({count: 50, diffLastGas: false}))
  addRow('simple - diff from previous', await runTest({count: 51, diffLastGas: true}))

  const huge = '0x'.padEnd(20480, 'f')

  addRow('big tx', await runTest({count: 1, destCallData: huge, diffLastGas: false}))
  addRow('big tx - diff from previous', await runTest({count: 2, destCallData: huge, diffLastGas: true}))

  addRow('big tx', await runTest({count: 50, destCallData: huge, diffLastGas: false}))
  addRow('big tx - diff from previous', await runTest({count: 51, destCallData: huge, diffLastGas: true}))

  doneTable()
  return
}

runGasCalcs()
  .then(() => process.exit(0))
  .catch(err => {
    console.log(err)
    process.exit(1)
  })
