import { ecrecover, ecsign, PrefixedHexString, pubToAddress, toBuffer, toChecksumAddress } from 'ethereumjs-util'
import { BigNumber, BigNumberish, Wallet } from 'ethers'
import { arrayify, hexConcat, hexlify, keccak256, RLP } from 'ethers/lib/utils'
import { tostr } from './testutils'

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
