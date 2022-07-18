import * as typ from './solidityTypes'

export interface UserOperation {

  sender: typ.address
  nonce: typ.uint256
  initCode: typ.bytes
  callData: typ.bytes
  callGas: typ.uint256
  verificationGas: typ.uint256
  preVerificationGas: typ.uint256
  maxFeePerGas: typ.uint256
  maxPriorityFeePerGas: typ.uint256
  paymaster: typ.address
  paymasterData: typ.bytes
  signature: typ.bytes
}
