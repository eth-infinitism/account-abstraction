import * as typ from './solidityTypes'

export interface UserOperation {

  sender: typ.address
  nonce: typ.uint256
  initCode: typ.bytes
  callData: typ.bytes
  callGasLimit: typ.uint128
  verificationGasLimit: typ.uint128
  preVerificationGas: typ.uint256
  maxFeePerGas: typ.uint256
  maxPriorityFeePerGas: typ.uint256
  paymaster: typ.address
  paymasterVerificationGasLimit: typ.uint128
  paymasterPostOpGasLimit: typ.uint128
  paymasterData: typ.bytes
  signature: typ.bytes
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
