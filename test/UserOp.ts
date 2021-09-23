import {arrayify, defaultAbiCoder, keccak256} from "ethers/lib/utils";
import {BigNumber, Contract, Signer, Wallet} from "ethers";
import {AddressZero, HashZero, rethrow} from "./testutils";
import {ecsign, toRpcSig, keccak256 as keccak256_buffer} from "ethereumjs-util";
import {Singleton} from '../typechain'
import assert from "assert";
import {UserOperation} from "./UserOperation";

export function packUserOp(op: UserOperation): string {
  return defaultAbiCoder.encode([
    'address', // target
    'uint256', // nonce
    'bytes32', // initCode
    'bytes32', // callData
    'uint256', // callGas
    'uint', // verificationGas
    'uint256', // maxFeePerGas
    'uint256', // maxPriorityFeePerGas
    'address', // paymaster
    'bytes32', // paymasterData
  ], [
    op.target,
    op.nonce,
    keccak256(op.initCode),
    keccak256(op.callData),
    op.callGas,
    op.verificationGas,
    op.maxFeePerGas,
    op.maxPriorityFeePerGas,
    op.paymaster,
    keccak256(op.paymasterData)
  ])
}

export const DefaultsForUserOp: UserOperation = {
  target: AddressZero,
  nonce: 0,
  initCode: '0x',
  callData: '0x',
  callGas: 0,
  verificationGas: 100000,  //default verification gas. will add create2 cost (3200+200*length) if initCode exists
  maxFeePerGas: 0,
  maxPriorityFeePerGas: 1e9,
  paymaster: AddressZero,
  paymasterData: '0x',
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
    signature: signedMessage1
  }
}

export function fillUserOp(op: Partial<UserOperation>, defaults = DefaultsForUserOp): UserOperation {
  const partial: any = {...op}
  //we want "item:undefined" to be used from defaults, and not override defaults, so we must explicitly
  // remove those so "merge" will succeed.
  for (let key in partial) {
    if (partial[key] == undefined) {
      delete partial[key]
    }
  }
  const filled = {...defaults, ...partial}
  return filled
}

//helper to fill structure:
// - default callGas to estimate call from singleton to wallet (TODO: add overhead)
// if there is initCode:
//  - default nonce (used as salt) to zero
//  - calculate target using getAccountAddress
//  - default verificationGas to create2 cost + 100000
// no initCode:
//  - update nonce from wallet.nonce()
//singleton param is only required to fill in "target address when specifying "initCode"
//nonce: assume contract as "nonce()" function, and fill in.
// target - only in case of construction: fill target from initCode.
// callGas: VERY crude estimation (by estimating call to wallet, and add rough singleton overhead
// verificationGas: hard-code default at 100k. should add "create2" cost
export async function fillAndSign(op: Partial<UserOperation>, signer: Wallet | Signer, singleton?: Singleton): Promise<UserOperation> {
  let op1 = {...op}
  let provider = singleton?.provider
  if (op.initCode != null) {
    if (!op1.nonce) op1.nonce = 0
    if (op1.target == null) {
      if (singleton == null) throw new Error('must have singleton to calc target address from initCode')
      op1.target = await singleton!.getAccountAddress(op.initCode, op1.nonce)
    }
    if (op1.verificationGas == null) {
      op1.verificationGas = BigNumber.from(DefaultsForUserOp.verificationGas).add(32000 + 200 * op.initCode.length / 2)
    }
  }
  if (op1.nonce == null) {
    if (provider == null) throw new Error('must have singleton to autofill nonce')
    const c = new Contract(op.target!, ['function nonce() view returns(address)'], provider)
    op1.nonce = await c.nonce().catch(rethrow())
  }
  if (op1.callGas == null && op.callData != null) {
    if (provider == null) throw new Error('must have singleton for callGas estimate')
    const gasEtimated = await provider.estimateGas({
      from: singleton?.address,
      to: op1.target,
      data: op1.callData
    })

    // console.log('estim', op1.target,'len=', op1.callData!.length, 'res=', gasEtimated)
    //estimateGas assumes direct call from singleton. add wrapper cost.
    op1.callGas = gasEtimated //.add(55000)
  }
  if (op1.maxFeePerGas == null) {
    if (provider == null) throw new Error('must have singleton to autofill maxFeePerGas')
    const block = await provider.getBlock('latest');
    op1.maxFeePerGas = block.baseFeePerGas!.add(op1.maxPriorityFeePerGas ?? DefaultsForUserOp.maxPriorityFeePerGas)
  }
  //TODO: this is exactly what fillUserOp below should do - but it doesn't.
  // adding this manually
  if (op1.maxPriorityFeePerGas == undefined) {
    op1.maxPriorityFeePerGas = DefaultsForUserOp.maxPriorityFeePerGas
  }
  let op2 = fillUserOp(op1);

  let packed = packUserOp(op2);
  let message = Buffer.from(arrayify(keccak256(packed)));
  return {
    ...op2,
    signature: await signer.signMessage(message)
  }
}
