import {arrayify, defaultAbiCoder, keccak256} from "ethers/lib/utils";
import {BigNumberish, Signer, Wallet} from "ethers";
import {AddressZero} from "./testutils";
import {BytesLike} from "@ethersproject/bytes";
import {ecsign, toRpcSig} from "ethereumjs-util";
import {waffle} from "hardhat";

//define the same types as used by typechain/ethers
type address = string
type uint256 = BigNumberish
type uint = BigNumberish
type uint64 = BigNumberish
type bytes = BytesLike

export interface UserOperation {
  target: address
  nonce: uint256
  callData: bytes
  callGas: uint64

  maxFeePerGas: uint
  maxPriorityFeePerGas: uint
  paymaster: address

  signer: address
  signature: bytes
}

export function packUserOp(op: UserOperation): string {
  return defaultAbiCoder.encode([
    'address', // target
    'uint256', // nonce
    'bytes', // callData
    'uint64', // callGas
    'uint', // maxFeePerGas
    'uint', // maxPriorityFeePerGas
    'address', // paymaster
  ], [
    op.target,
    op.nonce,
    op.callData,
    op.callGas,
    op.maxFeePerGas,
    op.maxPriorityFeePerGas,
    op.paymaster
  ])
}

export const ZeroUserOp: UserOperation = {
  target: AddressZero,
  nonce: 0,
  callData: '0x',
  callGas: 1,
  maxFeePerGas: 2,
  maxPriorityFeePerGas: 3,
  paymaster: AddressZero,
  signer: AddressZero,
  signature: '0x'
}

export async function signUserOp(op: UserOperation, signer: Wallet): Promise<UserOperation> {
  let packed = packUserOp(op);
  let message =  Buffer.from(arrayify(keccak256(packed)));
  const sig = ecsign(message, Buffer.from(arrayify(signer.privateKey)))
  return {
    ...op,
    signer: await signer.getAddress(),
    signature: await signer.signMessage(message)
  }
}

export function fillUserOp(op: Partial<UserOperation>, defaults = ZeroUserOp): UserOperation {
  const filled = {...defaults, ...op}
  return filled
}
