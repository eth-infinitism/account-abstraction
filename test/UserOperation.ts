import { BigNumberish, BytesLike } from 'ethers'
import * as typ from './solidityTypes'

export interface UserOperation {
  isEip7702?: boolean
  sender: string
  nonce: BigNumberish
  factory?: string
  factoryData?: BytesLike
  callData: BytesLike
  callGasLimit: BigNumberish
  verificationGasLimit: BigNumberish
  preVerificationGas: BigNumberish
  maxFeePerGas: BigNumberish
  maxPriorityFeePerGas: BigNumberish
  paymaster?: string
  paymasterVerificationGasLimit?: BigNumberish
  paymasterPostOpGasLimit?: BigNumberish
  paymasterData?: BytesLike
  paymasterSignature?: BytesLike
  signature: BytesLike
}

export interface PackedUserOperation {
  sender: typ.address
  nonce: typ.uint256
  initCode: typ.bytes
  callData: typ.bytes
  accountGasLimits: typ.bytes32
  preVerificationGas: typ.uint256
  gasFees: typ.bytes32
  paymasterAndData: typ.bytes
  signature: typ.bytes
}
