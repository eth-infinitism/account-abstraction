import {
  arrayify,
  defaultAbiCoder, hexConcat, hexDataLength,
  hexDataSlice, hexlify,
  keccak256
} from 'ethers/lib/utils'
import { BigNumber, Contract, Signer, Wallet } from 'ethers'
import { TypedDataSigner, TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer'
import {
  AddressZero,
  callDataCost,
  decodeRevertReason,
  packAccountGasLimits,
  packPaymasterData,
  rethrow
} from './testutils'
import { ecsign, toRpcSig } from 'ethereumjs-util'
import {
  EntryPoint, EntryPointSimulations__factory
} from '../typechain'
import { PackedUserOperation, UserOperation } from './UserOperation'
import { Create2Factory } from '../src/Create2Factory'
import { TransactionRequest } from '@ethersproject/abstract-provider'

import EntryPointSimulationsJson from '../artifacts/contracts/core/EntryPointSimulations.sol/EntryPointSimulations.json'
import { ethers } from 'hardhat'
import { IEntryPointSimulations } from '../typechain/contracts/core/EntryPointSimulations'

// Matched to domain name, version from EntryPoint.sol:
const DOMAIN_NAME = 'ERC4337'
const DOMAIN_VERSION = '1'

// Matched to UserOperationLib.sol:
const PACKED_USEROP_TYPEHASH = keccak256(Buffer.from('PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)'))

export const INITCODE_EIP7702_MARKER = '0x7702'

export function packUserOp (userOp: UserOperation): PackedUserOperation {
  const accountGasLimits = packAccountGasLimits(userOp.verificationGasLimit, userOp.callGasLimit)
  const gasFees = packAccountGasLimits(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas)
  let paymasterAndData = '0x'
  if (userOp.paymaster?.length >= 20 && userOp.paymaster !== AddressZero) {
    paymasterAndData = packPaymasterData(userOp.paymaster as string, userOp.paymasterVerificationGasLimit, userOp.paymasterPostOpGasLimit, userOp.paymasterData as string)
  }
  return {
    sender: userOp.sender,
    nonce: userOp.nonce,
    callData: userOp.callData,
    accountGasLimits,
    initCode: userOp.initCode,
    preVerificationGas: userOp.preVerificationGas,
    gasFees,
    paymasterAndData,
    signature: userOp.signature
  }
}
export function encodeUserOp (userOp: UserOperation, forSignature = true): string {
  const packedUserOp = packUserOp(userOp)
  if (forSignature) {
    return defaultAbiCoder.encode(
      ['bytes32',
        'address', 'uint256', 'bytes32', 'bytes32',
        'bytes32', 'uint256', 'bytes32',
        'bytes32'],
      [PACKED_USEROP_TYPEHASH,
        packedUserOp.sender, packedUserOp.nonce, keccak256(packedUserOp.initCode), keccak256(packedUserOp.callData),
        packedUserOp.accountGasLimits, packedUserOp.preVerificationGas, packedUserOp.gasFees,
        keccak256(packedUserOp.paymasterAndData)])
  } else {
    // for the purpose of calculating gas cost encode also signature (and no keccak of bytes)
    return defaultAbiCoder.encode(
      ['bytes32',
        'address', 'uint256', 'bytes', 'bytes',
        'bytes32', 'uint256', 'bytes32',
        'bytes', 'bytes'],
      [PACKED_USEROP_TYPEHASH,
        packedUserOp.sender, packedUserOp.nonce, packedUserOp.initCode, packedUserOp.callData,
        packedUserOp.accountGasLimits, packedUserOp.preVerificationGas, packedUserOp.gasFees,
        packedUserOp.paymasterAndData, packedUserOp.signature])
  }
}

export function getUserOpHash (op: UserOperation, entryPoint: string, chainId: number): string {
  const packed = encodeUserOp(op, true)
  return keccak256(hexConcat([
    '0x1901',
    getDomainSeparator(entryPoint, chainId),
    keccak256(packed)
  ]))
}

export function isEip7702UserOp (op: UserOperation): boolean {
  return op.initCode != null && hexlify(op.initCode).startsWith(INITCODE_EIP7702_MARKER)
}

export function updateUserOpForEip7702Hash (op: UserOperation, delegate: string): UserOperation {
  if (!isEip7702UserOp(op)) {
    throw new Error('initCode should start with INITCODE_EIP7702_MARKER')
  }
  let initCode = hexlify(op.initCode)
  if (hexDataLength(initCode) < 20) {
    initCode = delegate
  } else {
    // replace address in initCode with delegate
    initCode = hexConcat([delegate, hexDataSlice(initCode, 20)])
  }
  return {
    ...op, initCode
  }
}

// calculate UserOpHash, given "sender" contract code.
// (only used if initCode starts with prefix)
export function getUserOpHashWithEip7702 (op: UserOperation, entryPoint: string, chainId: number, delegate: string): string {
  const op1 = updateUserOpForEip7702Hash(op, delegate)
  return getUserOpHash(op1, entryPoint, chainId)
}

export const DefaultsForUserOp: UserOperation = {
  sender: AddressZero,
  nonce: 0,
  initCode: '0x',
  callData: '0x',
  callGasLimit: 0,
  verificationGasLimit: 150000, // default verification gas. will add create2 cost (3200+200*length) if initCode exists
  preVerificationGas: 21000, // should also cover calldata cost.
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 1e9,
  paymaster: AddressZero,
  paymasterData: '0x',
  paymasterVerificationGasLimit: 3e5,
  paymasterPostOpGasLimit: 0,
  signature: '0x'
}

export function signUserOp (op: UserOperation, signer: Wallet, entryPoint: string, chainId: number, eip7702delegate?: string): UserOperation {
  let message
  if (isEip7702UserOp(op)) {
    if (eip7702delegate == null) {
      throw new Error('Must have eip7702delegate to sign')
    }
    message = getUserOpHashWithEip7702(op, entryPoint, chainId, eip7702delegate)
  } else {
    message = getUserOpHash(op, entryPoint, chainId)
  }

  const sig = ecsign(Buffer.from(arrayify(message)), Buffer.from(arrayify(signer.privateKey)))
  // that's equivalent of:  await signer.signTypedData(domain, types, packUserOp(op));
  // (but without "async")
  const signedMessage1 = toRpcSig(sig.v, sig.r, sig.s)
  return {
    ...op,
    signature: signedMessage1
  }
}

export function fillUserOpDefaults (op: Partial<UserOperation>, defaults = DefaultsForUserOp): UserOperation {
  const partial: any = { ...op }
  // we want "item:undefined" to be used from defaults, and not override defaults, so we must explicitly
  // remove those so "merge" will succeed.
  for (const key in partial) {
    if (partial[key] == null) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete partial[key]
    }
  }
  const filled = { ...defaults, ...partial }
  return filled
}

// Options for fill/sign UserOperations functions
export interface FillUserOpOptions {
  // account nonce function to call, if userOp doesn't contain nonce. defaults to "getNonce()"
  getNonceFunction?: string
  // eip7702 delegate. only needed if this is the creation UserOp (that is, a one that runs with the eip7702 authorization tuple).
  // if the option is missing (and this is an EIP-7702 UserOp), the "fill" functions will read the value from the account's address.
  eip7702delegate?: string
}

// helper to fill structure:
// - default callGasLimit to estimate call from entryPoint to account (TODO: add overhead)
// if there is initCode:
//  - calculate sender by eth_call the deployment code
//  - default verificationGasLimit estimateGas of deployment code plus default 100000
// no initCode:
//  - update nonce from account.getNonce()
// entryPoint param is only required to fill in "sender address when specifying "initCode"
// nonce: assume contract as "getNonce()" function, and fill in.
// sender - only in case of construction: fill sender from initCode.
// callGasLimit: VERY crude estimation (by estimating call to account, and add rough entryPoint overhead
// verificationGasLimit: hard-code default at 100k. should add "create2" cost
export async function fillUserOp (op: Partial<UserOperation>, entryPoint?: EntryPoint, options?: FillUserOpOptions): Promise<UserOperation> {
  const getNonceFunction = options?.getNonceFunction ?? 'getNonce'
  const op1 = { ...op }
  const provider = entryPoint?.provider
  if (op1.initCode != null) {
    if (isEip7702UserOp(op1 as UserOperation)) {
      if (provider == null) {
        throw new Error('must have provider to check eip7702 delegate')
      }
      const code = await provider.getCode(op1.sender!)
      if (code.length === 2) {
        if (options?.eip7702delegate == null) {
          throw new Error('must have eip7702delegate')
        }
      } else if (code.length !== 23 * 2 + 2) {
        throw new Error('sender is not an eip7702 delegate')
      }
      if (op1.nonce == null) {
        op1.nonce = await provider.getTransactionCount(op1.sender!)
      }
    } else {
      const initAddr = hexDataSlice(op1.initCode!, 0, 20)
      const initCallData = hexDataSlice(op1.initCode!, 20)
      if (op1.nonce == null) op1.nonce = 0
      if (op1.sender == null) {
        // hack: if the init contract is our known deployer, then we know what the address would be, without a view call
        if (initAddr.toLowerCase() === Create2Factory.contractAddress.toLowerCase()) {
          const ctr = hexDataSlice(initCallData, 32)
          const salt = hexDataSlice(initCallData, 0, 32)
          op1.sender = Create2Factory.getDeployedAddress(ctr, salt)
        } else {
          // console.log('\t== not our deployer. our=', Create2Factory.contractAddress, 'got', initAddr)
          if (provider == null) throw new Error('no entrypoint/provider')
          op1.sender = await entryPoint!.callStatic.getSenderAddress(op1.initCode!).catch(e => e.errorArgs.sender)
        }
      }
      if (op1.verificationGasLimit == null) {
        if (provider == null) throw new Error('no entrypoint/provider')
        const senderCreator = await entryPoint?.senderCreator()
        const initEstimate = await provider.estimateGas({
          from: senderCreator,
          to: initAddr,
          data: initCallData,
          gasLimit: 10e6
        })
        op1.verificationGasLimit = BigNumber.from(DefaultsForUserOp.verificationGasLimit).add(initEstimate)
      }
    }
  }
  if (op1.nonce == null) {
    if (provider == null) throw new Error('must have entryPoint to autofill nonce')
    const c = new Contract(op.sender!, [`function ${getNonceFunction}() view returns(uint256)`], provider)
    op1.nonce = await c[getNonceFunction]().catch(rethrow())
  }
  if (op1.callGasLimit == null && op.callData != null) {
    if (provider == null) throw new Error('must have entryPoint for callGasLimit estimate')
    const gasEtimated = await provider.estimateGas({
      from: entryPoint?.address,
      to: op1.sender,
      data: op1.callData
    })

    // console.log('estim', op1.sender,'len=', op1.callData!.length, 'res=', gasEtimated)
    // estimateGas assumes direct call from entryPoint. add wrapper cost.
    op1.callGasLimit = gasEtimated // .add(55000)
  }
  if (op1.paymaster != null) {
    if (op1.paymasterVerificationGasLimit == null) {
      op1.paymasterVerificationGasLimit = DefaultsForUserOp.paymasterVerificationGasLimit
    }
    if (op1.paymasterPostOpGasLimit == null) {
      op1.paymasterPostOpGasLimit = DefaultsForUserOp.paymasterPostOpGasLimit
    }
  }
  if (op1.maxFeePerGas == null) {
    if (provider == null) throw new Error('must have entryPoint to autofill maxFeePerGas')
    const block = await provider.getBlock('latest')
    op1.maxFeePerGas = block.baseFeePerGas!.add(op1.maxPriorityFeePerGas ?? DefaultsForUserOp.maxPriorityFeePerGas)
  }
  // TODO: this is exactly what fillUserOp below should do - but it doesn't.
  // adding this manually
  if (op1.maxPriorityFeePerGas == null) {
    op1.maxPriorityFeePerGas = DefaultsForUserOp.maxPriorityFeePerGas
  }
  const op2 = fillUserOpDefaults(op1)
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  if (op2.preVerificationGas.toString() === '0') {
    // TODO: we don't add overhead, which is ~21000 for a single TX, but much lower in a batch.
    op2.preVerificationGas = callDataCost(encodeUserOp(op2, false))
  }
  return op2
}

export async function fillAndPack (op: Partial<UserOperation>, entryPoint?: EntryPoint, options?: FillUserOpOptions): Promise<PackedUserOperation> {
  return packUserOp(await fillUserOp(op, entryPoint, options))
}

export function getDomainSeparator (entryPoint: string, chainId: number): string {
  const domainData = getErc4337TypedDataDomain(entryPoint, chainId)
  return keccak256(defaultAbiCoder.encode(
    ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
    [
      keccak256(Buffer.from('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
      keccak256(Buffer.from(domainData.name!)),
      keccak256(Buffer.from(domainData.version!)),
      domainData.chainId,
      domainData.verifyingContract
    ]))
}

export function getErc4337TypedDataDomain (entryPoint: string, chainId: number): TypedDataDomain {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId: chainId,
    verifyingContract: entryPoint
  }
}

export function getErc4337TypedDataTypes (): { [type: string]: TypedDataField[] } {
  return {
    PackedUserOperation: [
      { name: 'sender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'initCode', type: 'bytes' },
      { name: 'callData', type: 'bytes' },
      { name: 'accountGasLimits', type: 'bytes32' },
      { name: 'preVerificationGas', type: 'uint256' },
      { name: 'gasFees', type: 'bytes32' },
      { name: 'paymasterAndData', type: 'bytes' }
    ]
  }
}

/**
 * call eth_signTypedData_v4 to sign the UserOp
 * @param op
 * @param signer
 * @param entryPoint
 * @param eip7702delegate account's delegate. only needed if this is the creation UserOp (that is, a one that runs with the eip7702 authorization tuple).
 *  Otherwise, it will be obtained from the deployed account.
 */
export async function asyncSignUserOp (op: UserOperation, signer: Wallet | Signer, entryPoint?: EntryPoint, options?: FillUserOpOptions): Promise<string> {
  let eip7702delegate = options?.eip7702delegate
  const provider = entryPoint?.provider
  const chainId = await provider!.getNetwork().then(net => net.chainId)

  const typedSigner: TypedDataSigner = signer as any

  let userOpToSign = op
  if (isEip7702UserOp(userOpToSign)) {
    if (eip7702delegate == null) {
      const senderCode = await provider!.getCode(userOpToSign.sender)
      if (!senderCode.startsWith('0xef0100')) {
        if (senderCode === '0x') {
          throw new Error('sender contract not deployed. is this the first EIP-7702 message? add eip7702delegate to options')
        }
        throw new Error(`sender is not an eip7702 delegate: ${senderCode}`)
      }
      eip7702delegate = hexDataSlice(senderCode, 3)
    }
    userOpToSign = updateUserOpForEip7702Hash(userOpToSign, eip7702delegate)
  }

  const packedUserOp = packUserOp(userOpToSign)

  return await typedSigner._signTypedData(getErc4337TypedDataDomain(entryPoint!.address, chainId), getErc4337TypedDataTypes(), packedUserOp) // .catch(e => e.toString())
}

/**
 * fill userop fields, and sign it
 * @param op
 * @param signer the account owner that should sign the userOpHash
 * @param entryPoint account entrypoint.
 * @param options - see @FillOptions
 */
export async function fillAndSign (op: Partial<UserOperation>, signer: Wallet | Signer, entryPoint?: EntryPoint, options?: FillUserOpOptions): Promise<UserOperation> {
  const op2 = await fillUserOp(op, entryPoint, options)
  const signature = await asyncSignUserOp(op2, signer, entryPoint, options)

  return {
    ...op2,
    signature
  }
}

/**
 * utility method: call fillAndSign, and then pack it to submit to handleOps.
 */
export async function fillSignAndPack (op: Partial<UserOperation>, signer: Wallet | Signer, entryPoint?: EntryPoint, options?: FillUserOpOptions): Promise<PackedUserOperation> {
  const filledAndSignedOp = await fillAndSign(op, signer, entryPoint, options)
  return packUserOp(filledAndSignedOp)
}

/**
 * This function relies on a "state override" functionality of the 'eth_call' RPC method
 * in order to provide the details of a simulated validation call to the bundler
 * @param userOp
 * @param entryPointAddress
 * @param txOverrides
 */
export async function simulateValidation (
  userOp: PackedUserOperation,
  entryPointAddress: string,
  txOverrides?: any): Promise<IEntryPointSimulations.ValidationResultStructOutput> {
  const entryPointSimulations = EntryPointSimulations__factory.createInterface()
  const data = entryPointSimulations.encodeFunctionData('simulateValidation', [userOp])
  const tx: TransactionRequest = {
    to: entryPointAddress,
    data,
    ...txOverrides
  }
  const stateOverride = {
    [entryPointAddress]: {
      code: EntryPointSimulationsJson.deployedBytecode
    }
  }
  try {
    const simulationResult = await ethers.provider.send('eth_call', [tx, 'latest', stateOverride])
    const res = entryPointSimulations.decodeFunctionResult('simulateValidation', simulationResult)
    // note: here collapsing the returned "tuple of one" into a single value - will break for returning actual tuples
    return res[0]
  } catch (error: any) {
    const revertData = error?.data
    if (revertData != null) {
      // note: this line throws the revert reason instead of returning it
      entryPointSimulations.decodeFunctionResult('simulateValidation', revertData)
    }
    throw error
  }
}

// TODO: this code is very much duplicated but "encodeFunctionData" is based on 20 overloads
//  TypeScript is not able to resolve overloads with variables: https://github.com/microsoft/TypeScript/issues/14107
export async function simulateHandleOp (
  userOp: PackedUserOperation,
  target: string,
  targetCallData: string,
  entryPointAddress: string,
  txOverrides?: any): Promise<IEntryPointSimulations.ExecutionResultStructOutput> {
  const entryPointSimulations = EntryPointSimulations__factory.createInterface()
  const data = entryPointSimulations.encodeFunctionData('simulateHandleOp', [userOp, target, targetCallData])
  const tx: TransactionRequest = {
    to: entryPointAddress,
    data,
    ...txOverrides
  }
  const stateOverride = {
    [entryPointAddress]: {
      code: EntryPointSimulationsJson.deployedBytecode
    }
  }
  try {
    const simulationResult = await ethers.provider.send('eth_call', [tx, 'latest', stateOverride])
    const res = entryPointSimulations.decodeFunctionResult('simulateHandleOp', simulationResult)
    // note: here collapsing the returned "tuple of one" into a single value - will break for returning actual tuples
    return res[0]
  } catch (error: any) {
    const err = decodeRevertReason(error)
    if (err != null) {
      throw new Error(err)
    }
    throw error
  }
}
