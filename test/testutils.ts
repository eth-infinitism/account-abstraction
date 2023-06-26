import {
  keccak256,
  parseEther,
  toBeHex,
  BigNumberish,
  Signer,
  Wallet,
  BaseContract,
  getBytes,
  AbiCoder,
  concat,
  ZeroAddress,
  Provider,
  AddressLike,
  getBigInt, ContractTransactionReceipt, resolveAddress
} from 'ethers'

import { expect } from 'chai'
import { Create2Factory } from '../src/Create2Factory'
import { debugTransaction } from './debugTx'
import { UserOperation } from './UserOperation'
import { ethers } from 'hardhat'
import {
  EntryPoint,
  EntryPoint__factory, IEntryPoint,
  IERC20,
  SimpleAccount, SimpleAccount__factory,
  SimpleAccountFactory, SimpleAccountFactory__factory,
  TestAggregatedAccountFactory
} from '../src/types'

export const ONE_ETH = parseEther('1')
export const TWO_ETH = parseEther('2')
export const FIVE_ETH = parseEther('5')

export const tostr = (x: any): string => x != null ? x.toString() : 'null'

export const defaultAbiCoder = AbiCoder.defaultAbiCoder()

// just throw 1eth from account[0] to the given address (or contract instance)
export async function fund (contractOrAddress: AddressLike | BaseContract, amountEth = '1'): Promise<void> {
  const address = await resolveAddress(contractOrAddress)
  const signer = await ethers.provider.getSigner()
  console.log('funding', address)
  await signer.sendTransaction({ to: address, value: parseEther(amountEth) })
}

export async function getBalance (address: AddressLike): Promise<bigint> {
  return await ethers.provider.getBalance(address)
}

export async function getTokenBalance (token: IERC20, address: string): Promise<bigint> {
  return await token.balanceOf(address)
}

let counter = 0

// create non-random account, so gas calculations are deterministic
export function createAccountOwner (): Wallet {
  const privateKey = keccak256(toBeHex(++counter))
  return new ethers.Wallet(privateKey, ethers.provider)
  // return new ethers.Wallet('0x'.padEnd(66, privkeyBase), ethers.provider);
}

export function createAddress (): string {
  return createAccountOwner().address
}

export function callDataCost (data: string): bigint {
  return getBytes(data)
    .map(x => x === 0 ? 4 : 16)
    .reduce((sum, x) => sum + getBigInt(x), 0n)
}

export async function calcGasUsage (rcpt: ContractTransactionReceipt, entryPoint: EntryPoint, beneficiaryAddress?: string): Promise<{ actualGasCost: BigNumberish }> {
  const actualGas = await rcpt.gasUsed
  const logs = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt.blockHash)
  const { actualGasCost, actualGasUsed } = logs[0].args
  console.log('\t== actual gasUsed (from tx receipt)=', actualGas.toString())
  console.log('\t== calculated gasUsed (paid to beneficiary)=', actualGasUsed)
  const tx = await ethers.provider.getTransaction(rcpt.hash)
  console.log('\t== gasDiff', actualGas - actualGasUsed - callDataCost(tx!.data))
  if (beneficiaryAddress != null) {
    expect(await getBalance(beneficiaryAddress)).to.eq(actualGasCost)
  }
  return { actualGasCost }
}

// helper function to create the initCode to deploy the account, using our account factory.
export async function getAccountInitCode (owner: string, factory: SimpleAccountFactory, salt = 0): Promise<string> {
  return concat([
    await resolveAddress(factory.target),
    factory.interface.encodeFunctionData('createAccount', [owner, salt])
  ])
}

export async function getAggregatedAccountInitCode (entryPoint: AddressLike, factory: TestAggregatedAccountFactory, salt = 0): Promise<string> {
  // the test aggregated account doesn't check the owner...
  const owner = ZeroAddress
  return concat([
    await resolveAddress(factory.target),
    factory.interface.encodeFunctionData('createAccount', [owner, salt])
  ])
}

// given the parameters as AccountDeployer, return the resulting "counterfactual address" that it would create.
export async function getAccountAddress (owner: string, factory: SimpleAccountFactory, salt = 0): Promise<string> {
  return await factory.getFunction('getAddress').staticCall(owner, salt)
}

const panicCodes: { [key: number]: string } = {
  // from https://docs.soliditylang.org/en/v0.8.0/control-structures.html
  0x01: 'assert(false)',
  0x11: 'arithmetic overflow/underflow',
  0x12: 'divide by zero',
  0x21: 'invalid enum value',
  0x22: 'storage byte array that is incorrectly encoded',
  0x31: '.pop() on an empty array.',
  0x32: 'array sout-of-bounds or negative index',
  0x41: 'memory overflow',
  0x51: 'zero-initialized variable of internal function type'
}

// rethrow "cleaned up" exception.
// - stack trace goes back to method (or catch) line, not inner provider
// - attempt to parse revert data (needed for geth)
// use with ".catch(rethrow())", so that current source file/line is meaningful.
export function rethrow (): (e: Error) => void {
  const callerStack = new Error().stack!.replace(/Error.*\n.*at.*\n/, '').replace(/.*at.* \(internal[\s\S]*/, '')

  if (arguments[0] != null) {
    throw new Error('must use .catch(rethrow()), and NOT .catch(rethrow)')
  }
  return function (e: Error) {
    const solstack = e.stack!.match(/((?:.* at .*\.sol.*\n)+)/)
    const stack = (solstack != null ? solstack[1] : '') + callerStack
    // const regex = new RegExp('error=.*"data":"(.*?)"').compile()
    const found = /error=.*?"data":"(.*?)"/.exec(e.message)
    let message: string
    if (found != null) {
      const data = found[1]
      message = decodeRevertReason(data) ?? e.message + ' - ' + data.slice(0, 100)
    } else {
      message = e.message
    }
    const err = new Error(message)
    err.stack = 'Error: ' + message + '\n' + stack
    throw err
  }
}

export function decodeRevertReason (data: string, nullIfNoMatch = true): string | null {
  const methodSig = data.slice(0, 10)
  const dataParams = '0x' + data.slice(10)

  if (methodSig === '0x08c379a0') {
    const [err] = defaultAbiCoder.decode(['string'], dataParams)
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `Error(${err})`
  } else if (methodSig === '0x00fa072b') {
    const [opindex, paymaster, msg] = defaultAbiCoder.decode(['uint256', 'address', 'string'], dataParams)
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `FailedOp(${opindex}, ${paymaster !== ZeroAddress ? paymaster : 'none'}, ${msg})`
  } else if (methodSig === '0x4e487b71') {
    const [code] = defaultAbiCoder.decode(['uint256'], dataParams)
    return `Panic(${panicCodes[code] ?? code} + ')`
  }
  if (!nullIfNoMatch) {
    return data
  }
  return null
}

let currentNode: string = ''

export function getProviderSendFunction (provider: Provider): (method: string, params: any[]) => Promise<any> {
  const p = provider as any
  return _getProviderSendFunction([p, p.provider, p.provider?._hardhatProvider])
}

function _getProviderSendFunction (objs: any[]): (method: string, params: any[]) => Promise<any> {
  for (const obj of objs) {
    if (obj != null && typeof obj.send === 'function') {
      return obj.send.bind(obj)
    }
  }
  throw new Error('no "send()" function in provider')
}

// basic geth support
// - by default, has a single account. our code needs more.
export async function checkForGeth (): Promise<void> {
  const providerSendFunction = getProviderSendFunction(ethers.provider)
  currentNode = await providerSendFunction('web3_clientVersion', [])

  console.log('node version:', currentNode)
  // NOTE: must run geth with params:
  // --http.api personal,eth,net,web3
  // --allow-insecure-unlock
  if (currentNode.match(/geth/i) != null) {
    for (let i = 0; i < 2; i++) {
      const acc = await providerSendFunction('personal_newAccount', ['pass']).catch(rethrow)
      await providerSendFunction('personal_unlockAccount', [acc, 'pass']).catch(rethrow)
      await fund(acc, '10')
    }
  }
}

// remove "array" members, convert values to strings.
// so Result obj like
// { '0': "a", '1': 20, first: "a", second: 20 }
// becomes:
// { first: "a", second: "20" }
export function objdump (obj: { [key: string]: any }): any {
  return Object.keys(obj)
    .filter(key => key.match(/^[\d_]/) == null)
    .reduce((set, key) => ({
      ...set,
      [key]: decodeRevertReason(obj[key].toString(), false)
    }), {})
}

export async function checkForBannedOps (txHash: string, checkPaymaster: boolean): Promise<void> {
  const tx = await debugTransaction(txHash)
  const logs = tx.structLogs
  const blockHash = logs.map((op, index) => ({ op: op.op, index })).filter(op => op.op === 'NUMBER')
  expect(blockHash.length).to.equal(2, 'expected exactly 2 call to NUMBER (Just before and after validateUserOperation)')
  const validateAccountOps = logs.slice(0, blockHash[0].index - 1)
  const validatePaymasterOps = logs.slice(blockHash[0].index + 1)
  const ops = validateAccountOps.filter(log => log.depth > 1).map(log => log.op)
  const paymasterOps = validatePaymasterOps.filter(log => log.depth > 1).map(log => log.op)

  expect(ops).to.include('POP', 'not a valid ops list: ' + JSON.stringify(ops)) // sanity
  const bannedOpCodes = new Set(['GAS', 'BASEFEE', 'GASPRICE', 'NUMBER'])
  expect(ops.filter((op, index) => {
    // don't ban "GAS" op followed by "*CALL"
    if (op === 'GAS' && (ops[index + 1].match(/CALL/) != null)) {
      return false
    }
    return bannedOpCodes.has(op)
  })).to.eql([])
  if (checkPaymaster) {
    expect(paymasterOps).to.include('POP', 'not a valid ops list: ' + JSON.stringify(paymasterOps)) // sanity
    expect(paymasterOps).to.not.include('BASEFEE')
    expect(paymasterOps).to.not.include('GASPRICE')
    expect(paymasterOps).to.not.include('NUMBER')
  }
}

const entryPointInterface = EntryPoint__factory.createInterface()

export function parseEntryPointError (error: any): { name: string, args: { [key: string]: any } } | undefined {
  const ret = entryPointInterface.parseError(error.data.data ?? error.data)
  if (ret == null) return undefined

  // unfortunately, returned args is an array, not object.
  // need to reconstruct the names from the ABI
  const argsObject = ret!.fragment.inputs.reduce((set, input, currentIndex) => ({
    [input.name]: ret?.args[currentIndex],
    ...set
  }), {})
  return {
    name: ret.name,
    args: argsObject
  }
}

export class EntryPointError extends Error {
  args: { [key: string]: any }
  name: string

  constructor (error: any) {
    const ret = parseEntryPointError(error) ?? { name: error.message, args: {} }
    // eslint-disable-next-line
    super(`${ret?.name}(${ret?.args})`)
    this.name = ret.name
    this.args = ret.args
  }
}

/**
 * process exception of ValidationResult
 * usage: entryPoint.simulationResult.staticCall(..).catch(simulationResultCatch)
 */
export function simulationResultCatch (e: any): any {
  const { name, args } = parseEntryPointError(e) ?? {}
  if (name !== 'ValidationResult') { throw e }

  return args
}

/**
 * process exception of getSenderAddress
 * usage: entryPoint.getSenderAddress.staticCall(..).catch(SenderAddressResult)
 */export function parseGetSenderAddressResult (e: any): string {
  const { name, args } = parseEntryPointError(e) ?? {}
  if (name !== 'SenderAddressResult') {
    throw e
  }

  return args?.sender
}

/**
 * process exception of ValidationResultWithAggregation
 * usage: entryPoint.simulationResult(..).catch(simulationResultWithAggregation)
 */
export function simulationResultWithAggregationCatch (e: any): any {
  const { name, args } = parseEntryPointError(e) ?? {}
  if (name !== 'ValidationResultWithAggregation') {
    throw e
  }
  return args?.errorArgs
}

export async function deployEntryPoint (provider = ethers.provider): Promise<EntryPoint> {
  const create2factory = new Create2Factory(provider)
  const addr = await create2factory.deploy(EntryPoint__factory.bytecode, 0, process.env.COVERAGE != null ? 20e6 : 8e6)
  const signer = await provider.getSigner()
  return EntryPoint__factory.connect(addr, signer)
}

export async function isDeployed (addr: string): Promise<boolean> {
  const code = await ethers.provider.getCode(addr)
  return code.length > 2
}

// internal helper function: create a UserOpsPerAggregator structure, with no aggregator or signature
export function userOpsWithoutAgg (userOps: UserOperation[]): IEntryPoint.UserOpsPerAggregatorStruct[] {
  return [{
    userOps,
    aggregator: ZeroAddress,
    signature: '0x'
  }]
}

// Deploys an implementation and a proxy pointing to this implementation
export async function createAccount (
  ethersSigner: Signer,
  accountOwner: string,
  entryPoint: AddressLike,
  _factory?: SimpleAccountFactory
):
  Promise<{
    proxy: SimpleAccount
    accountFactory: SimpleAccountFactory
    implementation: string
  }> {
  const accountFactory = _factory ?? await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint)
  const implementation = await accountFactory.accountImplementation()
  await accountFactory.createAccount(accountOwner, 0)
  const accountAddress = await accountFactory.getFunction('getAddress').staticCall(accountOwner, 0)

  const proxy = SimpleAccount__factory.connect(accountAddress, ethersSigner)
  return {
    implementation,
    accountFactory,
    proxy
  }
}
