import { ecrecover, ecsign, PrefixedHexString, pubToAddress, toBuffer, toChecksumAddress } from 'ethereumjs-util'
import { BigNumber, BigNumberish, Wallet } from 'ethers'
import { arrayify, hexConcat, hexlify, keccak256, RLP } from 'ethers/lib/utils'
import { tostr } from './testutils'
import { TransactionRequest } from '@ethersproject/abstract-provider'

// from: https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md
// authority = ecrecover(keccak(MAGIC || rlp([chain_id, address, nonce])), y_parity, r, s)

const EIP7702_MAGIC = '0x05'

export interface UnsignedEIP7702Authorization {
  chainId: BigNumberish
  address: string
  nonce?: BigNumberish
}

export interface EIP7702Authorization extends UnsignedEIP7702Authorization {
  yParity: BigNumberish
  r: BigNumberish
  s: BigNumberish
}

export function toRlpHex (s: any): PrefixedHexString {
  if (BigNumber.isBigNumber(s) || typeof s === 'number') {
    s = BigNumber.from(s).toHexString()
  }
  let ret = s.replace(/0x0*/, '0x')
  // make sure hex string is not odd-length
  if (ret.length % 2 === 1) {
    ret = ret.replace('0x', '0x0')
  }
  return ret as PrefixedHexString
}

export function eip7702DataToSign (authorization: UnsignedEIP7702Authorization): PrefixedHexString {
  const rlpData = [
    toRlpHex(authorization.chainId),
    toRlpHex(authorization.address),
    toRlpHex(authorization.nonce)
  ]
  return keccak256(hexConcat([
    EIP7702_MAGIC,
    RLP.encode(rlpData)
  ]))
}

export function getEip7702AuthorizationSigner (authorization: EIP7702Authorization, chainId?: number): string {
  const yParity = BigNumber.from(authorization.yParity).toHexString()
  // yParity = 28
  const r = toBuffer(tostr(authorization.r))
  const s = toBuffer(tostr(authorization.s))
  const dataToSign = toBuffer(eip7702DataToSign(authorization))
  const retRecover = pubToAddress(ecrecover(dataToSign, yParity, r, s))
  return toChecksumAddress(hexlify(retRecover))
}

// geth only accepts hex values with no leading zeroes (except for zero itself)
export function gethHex (n: BigNumberish): string {
  return BigNumber.from(n).toHexString().replace(/0x0(.)/, '0x$1')
}

export async function signEip7702Authorization (signer: Wallet, authorization: UnsignedEIP7702Authorization): Promise<EIP7702Authorization> {
  const nonce = authorization.nonce ?? await signer.getTransactionCount()
  const dataToSign = toBuffer(eip7702DataToSign({ nonce, ...authorization }))
  const sig = ecsign(dataToSign, arrayify(signer.privateKey) as any)
  return {
    address: authorization.address,
    chainId: gethHex(authorization.chainId),
    nonce: gethHex(nonce),
    yParity: gethHex(sig.v - 27),
    r: gethHex(sig.r),
    s: gethHex(sig.s)
  }
}

// TODO: quickfix; must update Ethers.js to v6, use the normal 'signTransaction' there, and remove this custom function
export async function signEip7702RawTransaction (signer: Wallet, txRequest: TransactionRequest): Promise<PrefixedHexString> {
  const nonce = txRequest.nonce ?? await signer.getTransactionCount()
  const chainId = txRequest.chainId ?? await signer.getChainId()
  const gasLimit = txRequest.gasLimit ?? 21000
  const maxFeePerGas = txRequest.maxFeePerGas ?? await signer.provider!.getGasPrice()
  const maxPriorityFeePerGas = txRequest.maxPriorityFeePerGas ?? maxFeePerGas
  const to = txRequest.to ?? '0x'
  const value = txRequest.value ?? 0
  const data = txRequest.data ?? '0x'
  const authorizationList = (txRequest as any).authorizationList ?? []

  // EIP-7702 transaction format (type 0x04):
  // 0x04 || rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, destination, value, data, access_list, authorization_list, signature_y_parity, signature_r, signature_s])

  // Encode authorization list: [[chain_id, address, nonce, y_parity, r, s], ...]
  const encodedAuthList = authorizationList.map((auth: any) => [
    toRlpHex(auth.chainId),
    toRlpHex(auth.address),
    toRlpHex(auth.nonce),
    toRlpHex(auth.yParity),
    toRlpHex(auth.r),
    toRlpHex(auth.s)
  ])

  // Transaction payload without signature
  const txData = [
    toRlpHex(chainId),
    toRlpHex(nonce),
    toRlpHex(maxPriorityFeePerGas),
    toRlpHex(maxFeePerGas),
    toRlpHex(gasLimit),
    toRlpHex(to),
    toRlpHex(value),
    toRlpHex(data),
    [], // access_list (empty for now)
    encodedAuthList
  ]

  // Hash the unsigned transaction
  const txHash = keccak256(hexConcat(['0x04', RLP.encode(txData)]))

  // Sign the transaction
  const sig = ecsign(toBuffer(txHash), arrayify(signer.privateKey) as any)

  // Add signature to transaction data
  const signedTxData = [
    ...txData,
    toRlpHex(sig.v - 27), // y_parity (v - 27 for EIP-155)
    toRlpHex('0x' + sig.r.toString('hex')),
    toRlpHex('0x' + sig.s.toString('hex'))
  ]

  // Encode and return: 0x04 || rlp(transaction)
  return hexConcat(['0x04', RLP.encode(signedTxData)]) as PrefixedHexString
}
