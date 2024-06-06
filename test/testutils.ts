import { ethers } from 'hardhat'
import {
  arrayify,
  hexConcat, hexDataSlice,
  hexlify,
  hexZeroPad,
  Interface,
  keccak256,
  parseEther
} from 'ethers/lib/utils'
import { BigNumber, BigNumberish, Contract, ContractReceipt, Signer, Wallet } from 'ethers'
import {
  EntryPoint,
  EntryPoint__factory,
  IERC20,
  SimpleAccount,
  SimpleAccountFactory__factory,
  SimpleAccount__factory,
  SimpleAccountFactory,
  TestAggregatedAccountFactory, TestPaymasterRevertCustomError__factory, TestERC20__factory
} from '../typechain'
import { BytesLike, Hexable } from '@ethersproject/bytes'
import { expect } from 'chai'
import { Create2Factory } from '../src/Create2Factory'
import { debugTransaction } from './debugTx'
import { UserOperation } from './UserOperation'
import { packUserOp, simulateValidation } from './UserOp'

export const AddressZero = ethers.constants.AddressZero
export const HashZero = ethers.constants.HashZero
export const ONE_ETH = parseEther('1')
export const TWO_ETH = parseEther('2')
export const FIVE_ETH = parseEther('5')

export const tostr = (x: any): string => x != null ? x.toString() : 'null'

export function tonumber (x: any): number {
  try {
    return parseFloat(x.toString())
  } catch (e: any) {
    console.log('=== failed to parseFloat:', x, (e).message)
    return NaN
  }
}

// just throw 1eth from account[0] to the given address (or contract instance)
export async function fund (contractOrAddress: string | Contract, amountEth = '1'): Promise<void> {
  let address: string
  if (typeof contractOrAddress === 'string') {
    address = contractOrAddress
  } else {
    address = contractOrAddress.address
  }
  await ethers.provider.getSigner().sendTransaction({ to: address, value: parseEther(amountEth) })
}

export async function getBalance (address: string): Promise<number> {
  const balance = await ethers.provider.getBalance(address)
  return parseInt(balance.toString())
}

export async function getTokenBalance (token: IERC20, address: string): Promise<number> {
  const balance = await token.balanceOf(address)
  return parseInt(balance.toString())
}

let counter = 0

// create non-random account, so gas calculations are deterministic
export function createAccountOwner (): Wallet {
  const privateKey = keccak256(Buffer.from(arrayify(BigNumber.from(++counter))))
  return new ethers.Wallet(privateKey, ethers.provider)
  // return new ethers.Wallet('0x'.padEnd(66, privkeyBase), ethers.provider);
}

export function createAddress (): string {
  return createAccountOwner().address
}

export function callDataCost (data: string): number {
  return ethers.utils.arrayify(data)
    .map(x => x === 0 ? 4 : 16)
    .reduce((sum, x) => sum + x)
}

export async function calcGasUsage (rcpt: ContractReceipt, entryPoint: EntryPoint, beneficiaryAddress?: string): Promise<{ actualGasCost: BigNumberish }> {
  const actualGas = await rcpt.gasUsed
  const logs = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt.blockHash)
  const { actualGasCost, actualGasUsed } = logs[0].args
  console.log('\t== actual gasUsed (from tx receipt)=', actualGas.toString())
  console.log('\t== calculated gasUsed (paid to beneficiary)=', actualGasUsed)
  const tx = await ethers.provider.getTransaction(rcpt.transactionHash)
  console.log('\t== gasDiff', actualGas.toNumber() - actualGasUsed.toNumber() - callDataCost(tx.data))
  if (beneficiaryAddress != null) {
    expect(await getBalance(beneficiaryAddress)).to.eq(actualGasCost.toNumber())
  }
  return { actualGasCost }
}

// helper function to create the initCode to deploy the account, using our account factory.
export function getAccountInitCode (owner: string, factory: SimpleAccountFactory, salt = 0): BytesLike {
  return hexConcat([
    factory.address,
    factory.interface.encodeFunctionData('createAccount', [owner, salt])
  ])
}

export async function getAggregatedAccountInitCode (factory: TestAggregatedAccountFactory, salt = 0): Promise<BytesLike> {
  // the test aggregated account doesn't check the owner...
  const owner = AddressZero
  return hexConcat([
    factory.address,
    factory.interface.encodeFunctionData('createAccount', [owner, salt])
  ])
}

// given the parameters as AccountDeployer, return the resulting "counterfactual address" that it would create.
export async function getAccountAddress (owner: string, factory: SimpleAccountFactory, salt = 0): Promise<string> {
  return await factory.getAddress(owner, salt)
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

const decodeRevertReasonContracts = new Interface([
  ...EntryPoint__factory.createInterface().fragments,
  ...TestPaymasterRevertCustomError__factory.createInterface().fragments,
  ...TestERC20__factory.createInterface().fragments, // for OZ errors,
  'error ECDSAInvalidSignature()'
]) // .filter(f => f.type === 'error'))

export function decodeRevertReason (data: string | Error, nullIfNoMatch = true): string | null {
  if (typeof data !== 'string') {
    const err = data as any
    data = (err.data ?? err.error?.data) as string
    if (typeof data !== 'string') throw err
  }

  const methodSig = data.slice(0, 10)
  const dataParams = '0x' + data.slice(10)

  // can't add Error(string) to xface...
  if (methodSig === '0x08c379a0') {
    const [err] = ethers.utils.defaultAbiCoder.decode(['string'], dataParams)
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `Error(${err})`
  } else if (methodSig === '0x4e487b71') {
    const [code] = ethers.utils.defaultAbiCoder.decode(['uint256'], dataParams)
    return `Panic(${panicCodes[code] ?? code} + ')`
  }

  try {
    const err = decodeRevertReasonContracts.parseError(data)
    // treat any error "bytes" argument as possible error to decode (e.g. FailedOpWithRevert, PostOpReverted)
    const args = err.args.map((arg: any, index) => {
      switch (err.errorFragment.inputs[index].type) {
        case 'bytes' : return decodeRevertReason(arg)
        case 'string': return `"${(arg as string)}"`
        default: return arg
      }
    })
    return `${err.name}(${args.join(',')})`
  } catch (e) {
    // throw new Error('unsupported errorSig ' + data)
    if (!nullIfNoMatch) {
      return data
    }
    return null
  }
}

let currentNode: string = ''

// basic geth support
// - by default, has a single account. our code needs more.
export async function checkForGeth (): Promise<void> {
  // @ts-ignore
  const provider = ethers.provider._hardhatProvider

  currentNode = await provider.request({ method: 'web3_clientVersion' })

  console.log('node version:', currentNode)
  // NOTE: must run geth with params:
  // --http.api personal,eth,net,web3
  // --allow-insecure-unlock
  if (currentNode.match(/geth/i) != null) {
    for (let i = 0; i < 2; i++) {
      const acc = await provider.request({ method: 'personal_newAccount', params: ['pass'] }).catch(rethrow)
      await provider.request({ method: 'personal_unlockAccount', params: [acc, 'pass'] }).catch(rethrow)
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
  return obj == null
    ? null
    : Object.keys(obj)
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

export async function deployEntryPoint (provider = ethers.provider): Promise<EntryPoint> {
  const create2factory = new Create2Factory(provider)
  const addr = await create2factory.deploy(EntryPoint__factory.bytecode, process.env.SALT, process.env.COVERAGE != null ? 20e6 : 8e6)
  return EntryPoint__factory.connect(addr, provider.getSigner())
}

export async function isDeployed (addr: string): Promise<boolean> {
  const code = await ethers.provider.getCode(addr)
  return code.length > 2
}

// Deploys an implementation and a proxy pointing to this implementation
export async function createAccount (
  ethersSigner: Signer,
  accountOwner: string,
  entryPoint: string,
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
  const accountAddress = await accountFactory.getAddress(accountOwner, 0)
  const proxy = SimpleAccount__factory.connect(accountAddress, ethersSigner)
  return {
    implementation,
    accountFactory,
    proxy
  }
}

export function packAccountGasLimits (verificationGasLimit: BigNumberish, callGasLimit: BigNumberish): string {
  return ethers.utils.hexConcat([
    hexZeroPad(hexlify(verificationGasLimit, { hexPad: 'left' }), 16), hexZeroPad(hexlify(callGasLimit, { hexPad: 'left' }), 16)
  ])
}

export function packPaymasterData (paymaster: string, paymasterVerificationGasLimit: BytesLike | Hexable | number | bigint, postOpGasLimit: BytesLike | Hexable | number | bigint, paymasterData: string): string {
  return ethers.utils.hexConcat([
    paymaster, hexZeroPad(hexlify(paymasterVerificationGasLimit, { hexPad: 'left' }), 16),
    hexZeroPad(hexlify(postOpGasLimit, { hexPad: 'left' }), 16), paymasterData
  ])
}

export function unpackAccountGasLimits (accountGasLimits: string): { verificationGasLimit: number, callGasLimit: number } {
  return { verificationGasLimit: parseInt(accountGasLimits.slice(2, 34), 16), callGasLimit: parseInt(accountGasLimits.slice(34), 16) }
}

export interface ValidationData {
  aggregator: string
  validAfter: number
  validUntil: number
}

export const maxUint48 = (2 ** 48) - 1
export function parseValidationData (validationData: BigNumberish): ValidationData {
  const data = hexZeroPad(BigNumber.from(validationData).toHexString(), 32)

  // string offsets start from left (msb)
  const aggregator = hexDataSlice(data, 32 - 20)
  let validUntil = parseInt(hexDataSlice(data, 32 - 26, 32 - 20))
  if (validUntil === 0) {
    validUntil = maxUint48
  }
  const validAfter = parseInt(hexDataSlice(data, 0, 6))

  return {
    aggregator,
    validAfter,
    validUntil
  }
}

export function packValidationData (validationData: ValidationData): BigNumber {
  return BigNumber.from(validationData.validAfter).shl(48)
    .add(validationData.validUntil).shl(160)
    .add(validationData.aggregator)
}

// find the lowest number in the range min..max where testFunc returns true
export async function findMin (testFunc: (index: number) => Promise<boolean>, min: number, max: number, delta = 5): Promise<number> {
  if (await testFunc(min)) {
    throw new Error(`increase range: function already true at ${min}`)
  }
  if (!await testFunc(max)) {
    throw new Error(`no result: function is false for max value in ${min}..${max}`)
  }
  while (true) {
    const avg = Math.floor((max + min) / 2)
    if (await testFunc(avg)) {
      max = avg
    } else {
      min = avg
    }
    // console.log('== ', min, '...', max, max - min)
    if (Math.abs(max - min) < delta) {
      return max
    }
  }
}

/**
 * find the lowest value that when creating a userop, still doesn't revert and
 * doesn't emit UserOperationPrefundTooLow
 * note: using eth_snapshot/eth_revert, since we actually submit calls to handleOps
 * @param f function that return a signed userop, with parameter-under-test set to "n"
 * @param min range minimum. the function is expected to return false
 * @param max range maximum. the function is expected to be true
 * @param entryPoint entrypoint for "fillAndSign" of userops
 */
export async function findUserOpWithMin (f: (n: number) => Promise<UserOperation>, expectExec: boolean, entryPoint: EntryPoint, min: number, max: number, delta = 2): Promise<number> {
  const beneficiary = ethers.provider.getSigner().getAddress()
  return await findMin(
    async n => {
      const snapshot = await ethers.provider.send('evm_snapshot', [])
      try {
        const userOp = await f(n)
        // console.log('== userop=', userOp)
        const rcpt = await entryPoint.handleOps([packUserOp(userOp)], beneficiary, { gasLimit: 1e6 })
          .then(async r => r.wait())
        if (rcpt?.events?.find(e => e.event === 'UserOperationPrefundTooLow') != null) {
          // console.log('min', n, 'UserOperationPrefundTooLow')
          return false
        }
        if (expectExec) {
          const useropEvent = rcpt?.events?.find(e => e.event === 'UserOperationEvent')
          if (useropEvent?.args?.success !== true) {
            // console.log(rcpt?.events?.map((e: any) => ({ ev: e.event, ...objdump(e.args!) })))

            // console.log('min', n, 'success=false')
            return false
          }
        }
        // console.log('min', n, 'ok')
        return true
      } catch (e) {
        // console.log('min', n, 'ex=', decodeRevertReason(e as Error))
        return false
      } finally {
        await ethers.provider.send('evm_revert', [snapshot])
      }
    }, min, max, delta
  )
}

export async function findSimulationUserOpWithMin (f: (n: number) => Promise<UserOperation>, entryPoint: EntryPoint, min: number, max: number, delta = 2): Promise<number> {
  return await findMin(
    async n => {
      try {
        const userOp = await f(n)
        await simulateValidation(packUserOp(userOp), entryPoint.address)
        // console.log('sim', n, 'ok')
        return true
      } catch (e) {
        // console.log('sim', n, 'ex=', decodeRevertReason(e as Error))
        return false
      }
    }, min, max, delta
  )
}
