import {arrayify, defaultAbiCoder, keccak256} from "ethers/lib/utils";
import {BigNumber, Contract, Wallet} from "ethers";
import {AddressZero, HashZero} from "./testutils";
import {ecsign, toRpcSig, keccak256 as keccak256_buffer} from "ethereumjs-util";
import {Singleton} from '../typechain'
import assert from "assert";
import {UserOperation} from "./UserOperation";

export function packUserOp(op: UserOperation): string {
  return defaultAbiCoder.encode([
    'address', // target
    'uint256', // nonce
    'bytes', // initCode
    'bytes', // callData
    'uint256', // callGas
    'uint', // verificationGas
    'uint256', // maxFeePerGas
    'uint256', // maxPriorityFeePerGas
    'address', // paymaster
    'bytes', // paymasterData
  ], [
    op.target,
    op.nonce,
    op.initCode,
    op.callData,
    op.callGas,
    op.verificationGas,
    op.maxFeePerGas,
    op.maxPriorityFeePerGas,
    op.paymaster,
    op.paymasterData
  ])
}

export const ZeroUserOp: UserOperation = {
  target: AddressZero,
  nonce: 0,
  initCode: '0x',
  callData: '0x',
  callGas: 0,
  verificationGas: 100000,
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 1e9,
  paymaster: AddressZero,
  paymasterData: '0x',
  signer: AddressZero,
  signature: '0x'
}

export function signUserOp(op: UserOperation, signer: Wallet): UserOperation {
  let packed = packUserOp(op);
  let message = Buffer.from(arrayify(keccak256(packed)));
  let msg1 = Buffer.concat([
    Buffer.from("\x19Ethereum Signed Message:\n32", 'ascii'),
    message
  ])

  const sig = ecsign(keccak256_buffer(msg1), Buffer.from(arrayify(signer.privateKey)))
  // that's equivalent of:  await signer.signMessage(message);
  // (but without "async"
  let signedMessage1 = toRpcSig(sig.v, sig.r, sig.s);
  return {
    ...op,
    signer: signer.address,
    signature: signedMessage1
  }
}

export function fillUserOp(op: Partial<UserOperation>, defaults = ZeroUserOp): UserOperation {
  const filled = {...defaults, ...op}
  return filled
}

//singleton param is only required to fill in "target address when specifying "initCode"
//nonce: assume contract as "nonce()" function, and fill in.
// target - only in case of construction: fill target from initCode.
// callGas: VERY crude estimation (by estimating call to wallet, and add rough singleton overhead
// verificationGas: hard-code default at 100k. should add "create2" cost
export async function fillAndSign(op: Partial<UserOperation>, signer: Wallet, singleton?: Singleton): Promise<UserOperation> {
  let op1 = {...op}
  let provider = singleton?.provider ?? signer.provider;
  if (op.initCode != null) {
    op1.nonce = 0
    if (op1.target == null) {
      assert(singleton != null, 'must have singleton when using initCode')
      op1.target = await singleton!.getAccountAddress(op.initCode, op1.nonce)
    }
    if (op1.verificationGas == null) {
      op1.verificationGas = BigNumber.from(ZeroUserOp.verificationGas).add(32000 + 200 * op.initCode.length);
    }
  }
  if (op1.nonce == null) {
    const c = new Contract(op.target!, ['function nonce() view returns(address)'], provider)
    op1.nonce = await c.nonce()
  }
  if (op1.callGas == null) {
    const gasEtimated = await provider.estimateGas({
      from: singleton?.address ?? signer.address,
      to: op1.target,
      data: op1.callData
    })
    //estimateGas assumes direct call from singleton (or owner). add wrapper cost.
    op1.callGas = gasEtimated //.add(55000)
  }
  if (op1.maxFeePerGas == null) {
    const block = await provider.getBlock('latest');
    op1.maxFeePerGas = block.baseFeePerGas!.add(op1.maxPriorityFeePerGas ?? ZeroUserOp.maxPriorityFeePerGas)
  }
  let op2 = fillUserOp(op1);
  return signUserOp(op2, signer)
}
