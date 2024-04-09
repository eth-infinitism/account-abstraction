// calculate gas usage of different bundle sizes
import '../test/aa.init'
import { arrayify, defaultAbiCoder, formatEther, hexConcat, parseEther } from 'ethers/lib/utils'
import {
  AddressZero,
  checkForGeth,
  createAddress,
  createAccountOwner,
  deployEntryPoint
} from '../test/testutils'
import {
  EntryPoint, EntryPoint__factory, SimpleAccountFactory,
  SimpleAccountFactory__factory, SimpleAccount__factory, VerifyingPaymaster, VerifyingPaymaster__factory
} from '../typechain'
import { BigNumberish, Wallet } from 'ethers'
import hre from 'hardhat'
import { fillAndSign, fillUserOp, signUserOp } from '../test/UserOp'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import { table, TableUserConfig } from 'table'
import { Create2Factory } from '../src/Create2Factory'
import * as fs from 'fs'
import { SimpleAccountInterface } from '../typechain/contracts/samples/SimpleAccount'
import { UserOperation } from '../test/UserOperation'

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
  skipAccountCreation: boolean
  appendZerodevMode: boolean
  verifyingPaymaster: boolean
  factoryInfo?: (owner: string, salt: string) => Promise<{ factory: string, factoryData: string }>
  execInfo?: (target: string, value: BigNumberish, data: string) => string
  count: number
  // address, or 'random' or 'self' (for account itself)
  dest: string
  destValue: BigNumberish
  destCallData: string
  beneficiary: string
  gasPrice: number
}

export const DefaultGasTestInfo: Partial<GasTestInfo> = {
  dest: 'self', // destination is the account itself.
  destValue: parseEther('0'),
  destCallData: '0xb0d691fe', // entryPoint()
  gasPrice: 10e9
}

interface GasTestResult {
  title: string
  count: number
  gasUsed: number // actual gas used
  accountEst: number // estimateGas of the inner transaction (from EP to account)
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
const gasEstimatePerExec: { [key: string]: { title: string, accountEst: number } } = {}

/**
 * helper contract to generate gas test.
 * see runTest() method for "test template" info
 * override for different account implementation:
 * - accountInitCode() - the constructor code
 * - accountExec() the account execution method.
 */
export class GasChecker {
  accounts: { [account: string]: Wallet } = {}

  accountOwner: Wallet

  accountInterface: SimpleAccountInterface

  constructor () {
    this.accountOwner = createAccountOwner()
    this.accountInterface = SimpleAccount__factory.createInterface()
    void GasCheckCollector.init()
  }

  // generate the "exec" calldata for this account
  accountExec (dest: string, value: BigNumberish, data: string): string {
    return this.accountInterface.encodeFunctionData('execute', [dest, value, data])
    // return this.accountInterface.encodeFunctionData('execute(address,uint256,bytes,uint8)', [dest, value, data, 0])
  }

  factoryAddress: string|undefined
  globalSalt = 10000
  async simpleAccountFactoryInfo (owner: string, salt: string): Promise<any> {
    if (this.factoryAddress == null) {
      const create2Factory = new Create2Factory(this.entryPoint().provider)
      this.factoryAddress = await create2Factory.deploy(
        hexConcat([
          SimpleAccountFactory__factory.bytecode,
          defaultAbiCoder.encode(['address'], [this.entryPoint().address])
        ]), 0, 2885201)
    }
    const fact = SimpleAccountFactory__factory.connect(this.factoryAddress, ethersSigner)

    // console.log('create factoryinfo for ', owner, 'salt=', ++this.globalSalt)
    const ret = {
      factory: fact.address,
      factoryData: fact.interface.encodeFunctionData('createAccount', [owner, (++this.globalSalt).toString()])
    }
    console.log('factoryInfo= ', ret)
    return ret
  }

  // generate the account "creation code"
  accountInitCode (factory: SimpleAccountFactory, salt: BigNumberish): string {
    return hexConcat([
      factory.address,
      factory.interface.encodeFunctionData('createAccount', [this.accountOwner.address, salt])
    ])
  }

  createdAccounts = new Set<string>()

  /**
   * create accounts up to this counter.
   * make sure they all have balance.
   * do nothing for account already created
   * @param count
   */
  async createAccounts1 (count: number): Promise<void> {
    throw new Error('don\'t usecreateAccounts1')
    const create2Factory = new Create2Factory(this.entryPoint().provider)
    const factoryAddress = await create2Factory.deploy(
      hexConcat([
        SimpleAccountFactory__factory.bytecode,
        defaultAbiCoder.encode(['address'], [this.entryPoint().address])
      ]), 0, 2885201)
    console.log('factaddr', factoryAddress)
    GasCheckCollector.inst.setContractName(factoryAddress, 'SimpleAccountFactory')
    const fact = SimpleAccountFactory__factory.connect(factoryAddress, ethersSigner)

    const implAddress = await fact.accountImplementation()
    GasCheckCollector.inst.setContractName(implAddress, 'SimpleAccount')
    // create accounts
    const creationOps: UserOperation[] = []
    for (const n of range(count)) {
      const salt = n
      // const initCode = this.accountInitCode(fact, salt)

      const addr = await fact.getAddress(this.accountOwner.address, salt)

      if (!this.createdAccounts.has(addr)) {
        // explicit call to fillUseROp with no "entryPoint", to make sure we manually fill everything and
        // not attempt to fill from blockchain.
        const op = signUserOp(await fillUserOp({
          sender: addr,
          nonce: 0,
          callGasLimit: 30000,
          verificationGasLimit: 1000000,
          // paymasterAndData: paymaster,
          preVerificationGas: 1,
          maxFeePerGas: 0
        }), this.accountOwner, this.entryPoint().address, await provider.getNetwork().then(net => net.chainId))
        creationOps.push(op)
        this.createdAccounts.add(addr)
      }

      this.accounts[addr] = this.accountOwner
      // deploy if not already deployed.
      await fact.createAccount(this.accountOwner.address, salt)
      GasCheckCollector.inst.setContractName(addr, 'ERC1967Proxy')
      const accountBalance = await GasCheckCollector.inst.entryPoint.balanceOf(addr)
      if (accountBalance.lte(minDepositOrBalance)) {
        await GasCheckCollector.inst.entryPoint.depositTo(addr, { value: minDepositOrBalance.mul(5) })
      }
    }
    await this.entryPoint().handleOps(creationOps, ethersSigner.getAddress())
  }

  async insertAccount (address: string, owner: Wallet): Promise<void> {
    this.createdAccounts.add(address)
    this.accounts[address] = owner
  }

  /**
   * helper: run a test scenario, and add a table row
   * @param params - test parameters. missing values filled in from DefaultGasTestInfo
   * note that 2 important params are methods: accountExec() and accountInitCode()
   */
  async addTestRow (params: Partial<GasTestInfo>): Promise<void> {
    await GasCheckCollector.init()
    GasCheckCollector.inst.addRow(await this.runTest(params))
  }

  verifyingPaymaster: VerifyingPaymaster|undefined
  pmSigner: Wallet|undefined

  async initPaymaster (): Promise<VerifyingPaymaster> {
    if (this.verifyingPaymaster == null) {
      this.pmSigner = createAccountOwner()
      this.verifyingPaymaster = await new VerifyingPaymaster__factory(ethersSigner).deploy(this.entryPoint().address, this.pmSigner.address)
      await this.entryPoint().depositTo(this.verifyingPaymaster.address, { value: parseEther('0.5') })
    }
    return this.verifyingPaymaster
  }

  /**
   * run a single test scenario
   * @param params - test parameters. missing values filled in from DefaultGasTestInfo
   * note that 2 important params are methods: accountExec() and accountInitCode()
   */
  async runTest (params: Partial<GasTestInfo>): Promise<GasTestResult> {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const info: GasTestInfo = { ...DefaultGasTestInfo, ...params } as GasTestInfo
    // TODO: maybe better add it to defaultGasTestInfo ?

    if (info.factoryInfo == null) {
      info.factoryInfo = this.simpleAccountFactoryInfo.bind(this)
    }
    if (info.execInfo == null) {
      info.execInfo = this.accountExec.bind(this)
    }
    console.debug('== running test count=', info.count)

    // if (!info.skipAccountCreation) {
    //   // fill accounts up to this code.
    // await this.createAccounts1(info.count)
    // }

    let accountEst: number = 0
    const userOps = await Promise.all(range(info.count)
      .map(async index => {
        let account = 'invalid'
        // .map(index => Object.entries(this.accounts)[index])
        // .map(async ([account, accountOwner], index) => {
        let initCode: string | undefined
        const accountOwner = this.accountOwner
        console.log('account before', account, 'info=', info.factoryInfo)
        if (info.factoryInfo != null) {
          const f = await info.factoryInfo(accountOwner.address, index.toString())
          const ret = await provider.call({ to: f.factory, data: f.factoryData })
          account = defaultAbiCoder.decode(['address'], ret)[0]
          // if ((await getBalance(account)).eq(0)) {
          console.log('replenish new account', account)
          await ethersSigner.sendTransaction({ to: account, value: parseEther('1') })
          // }
          if (info.skipAccountCreation ?? false) {
            // pre-create the account before the test
            await ethersSigner.sendTransaction({ to: f.factory, data: f.factoryData })
          } else {
            // create account as part of the UserOp.
            initCode = hexConcat([f.factory, f.factoryData])
          }
        }

        let { dest, destValue, destCallData } = info
        if (dest === 'self') {
          dest = account
        } else if (dest === 'random') {
          dest = createAddress()
          GasCheckCollector.inst.setContractName(dest, '!EOA!')
          const destBalance = await getBalance(dest)
          if (destBalance.eq(0)) {
            console.log('dest replenish', dest)
            await ethersSigner.sendTransaction({ to: dest, value: 1 })
          }
        }
        const accountExecFromEntryPoint = info.execInfo != null
          ? info.execInfo(dest, destValue, destCallData)
          : this.accountExec(dest, destValue, destCallData)

        // remove the "dest" from the key to the saved estimations
        // so we have a single estimation per method.
        const estimateGasKey = this.accountExec(AddressZero, destValue, destCallData)

        let est = gasEstimatePerExec[estimateGasKey]
        // technically, each UserOp needs estimate - but we know they are all the same for each test.
        if (est == null) {
          const accountEst = (await ethers.provider.estimateGas({
            from: GasCheckCollector.inst.entryPoint.address,
            to: account,
            data: accountExecFromEntryPoint
          })).toNumber()
          est = gasEstimatePerExec[estimateGasKey] = { accountEst, title: info.title }
        }
        // console.debug('== account est=', accountEst.toString())
        accountEst = est.accountEst

        console.log('== account', account, 'deposit=', await this.entryPoint().balanceOf(account))
        const op1 = await fillUserOp({
          sender: account,
          initCode,
          callData: accountExecFromEntryPoint,
          maxPriorityFeePerGas: info.gasPrice,
          maxFeePerGas: info.gasPrice,
          callGasLimit: accountEst,
          verificationGasLimit: 1000000,
          paymasterAndData: info.verifyingPaymaster
            ? '0x1a3b1b07d3b56291b396f07f6860a8475b369f4300000000000000000000000000000000000000000000000000000000deadbeef00000000000000000000000000000000000000000000000000000000000012345ed020b1f5f615226124f277b5c49705ba7cc8cec8b594e136f988a5657eb8e11c5de83025d1c6ba0a1bd5c929a788a1441480b64b9a5ef2e8870f928bb13bc11c'
            : info.paymaster,
          preVerificationGas: 1
        }, GasCheckCollector.inst.entryPoint)

        if (info.verifyingPaymaster) {
          const pm = await this.initPaymaster()
          const MOCK_VALID_UNTIL = '0x00000000deadbeef'
          const MOCK_VALID_AFTER = '0x0000000000001234'
          const hash = await pm.getHash(op1, MOCK_VALID_UNTIL, MOCK_VALID_AFTER)
          const sig = await this.pmSigner!.signMessage(arrayify(hash))
          op1.paymasterAndData = hexConcat([pm.address, defaultAbiCoder.encode(['uint48', 'uint48'], [MOCK_VALID_UNTIL, MOCK_VALID_AFTER]), sig])
        }

        console.log('op1=', op1)
        const op = await fillAndSign(op1, accountOwner, GasCheckCollector.inst.entryPoint)
        console.log('op=', op)

        if (info.appendZerodevMode) {
          op.signature = '0x00000000' + op.signature.toString().replace('0x', '')
        }
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
      accountEst,
      title: info.title,
      receipt: rcpt
    }
    if (info.diffLastGas) {
      ret1.gasDiff = gasDiff
    }
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
  createJsonResult: boolean = false
  readonly contracts = new Map<string, string>()
  readonly txHashes: string[] = []

  setContractName (address: string, name: string): void {
    this.contracts.set(address.toLowerCase(), name)
  }

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
    this.setContractName(DefaultGasTestInfo.beneficiary, '!EOA! (beneficiary)')

    const bal = await getBalance(ethersSigner.getAddress())
    if (bal.gt(parseEther('100000000'))) {
      console.log('bal=', formatEther(bal))
      console.log('DONT use geth miner.. use account 2 instead')
      await checkForGeth()
      ethersSigner = ethers.provider.getSigner(2)
    }

    if (entryPointAddressOrTest === 'test') {
      this.entryPoint = await deployEntryPoint(provider)
    } else {
      this.entryPoint = EntryPoint__factory.connect(entryPointAddressOrTest, ethersSigner)
    }
    this.setContractName(this.entryPoint.address, 'EntryPoint')

    const tableHeaders = [
      'handleOps description         ',
      'count',
      'total gasUsed',
      // 'per UserOp gas\n(delta for\none UserOp)',
      // 'account.exec()\nestimateGas',
      // 'per UserOp overhead\n(compared to\naccount.exec())',
      'transaction hash'
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

    write('== gas estimate of direct calling the account\'s "execute" method')
    write('   the destination is "account.entryPoint()", which is known to be "hot" address used by this account')
    write('   it little higher than EOA call: its an exec from entrypoint (or account owner) into account contract, verifying msg.sender and exec to target)')

    write(table(Object.values(gasEstimatePerExec).map((row) => [
      `gas estimate "${row.title}"`, row.accountEst
    ]), this.tableConfig))

    const tableOutput = table(this.tabRows, this.tableConfig)
    write(tableOutput)
    if (this.createJsonResult) {
      this.writeResultInJson()
    }
    // process.exit(0)
  }

  writeResultInJson (): void {
    const res = {
      contracts: Object.fromEntries(this.contracts.entries()),
      transactions: this.txHashes
    }

    fs.writeFileSync(`gas-checker-result-${Date.now()}.json`, JSON.stringify(res))
  }

  addRow (res: GasTestResult): void {
    // const gasUsed = res.gasDiff != null ? '' : res.gasUsed // hide "total gasUsed" if there is a diff
    const gasUsed = res.gasUsed
    const perOp = res.gasDiff != null ? res.gasDiff - res.accountEst : ''

    this.tabRows.push([
      res.title,
      res.count,
      gasUsed,
      // res.gasDiff ?? '',
      // res.accountEst,
      // perOp,
      res.receipt?.transactionHash])

    this.txHashes.push(res.receipt!.transactionHash)
  }
}

after(() => {
  GasCheckCollector.inst.doneTable()
})
