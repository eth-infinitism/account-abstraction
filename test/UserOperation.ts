import * as typ from "./solidityTypes";

export interface UserOperation {

  target: typ.address
  nonce: typ.uint256
  initCode: typ.bytes
  callData: typ.bytes
  callGas: typ.uint64
  verificationGas: typ.uint
  maxFeePerGas: typ.uint64
  maxPriorityFeePerGas: typ.uint64
  paymaster: typ.address
  paymasterData: typ.bytes
  signer: typ.address
  signature: typ.bytes
}
