import * as typ from "./solidityTypes";

export interface UserOperation {

  target: typ.address
  nonce: typ.uint256
  initCode: typ.bytes
  callData: typ.bytes
  callGas: typ.uint
  verificationGas: typ.uint
  maxFeePerGas: typ.uint
  maxPriorityFeePerGas: typ.uint
  paymaster: typ.address
  paymasterData: typ.bytes
  signature: typ.bytes
}
