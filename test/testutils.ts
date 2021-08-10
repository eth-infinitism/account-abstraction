import {ethers} from "hardhat";
import {parseEther} from "ethers/lib/utils";
import {Contract, Wallet} from "ethers";
import { IERC20}from '../typechain'
export const AddressZero = ethers.constants.AddressZero
export const ONE_ETH = parseEther('1');

export const tostr = (x: any) => x != null ? x.toString() : 'null'

export function tonumber(x: any): number {

  try {
    return parseFloat(x.toString())
  } catch (e) {
    console.log('=== failed to parseFloat:', x, e.message)
    return NaN
  }
}

//just throw 1eth from account[0] to the given address (or contract instance)
export async function fund(contractOrAddress: string | Contract) {
  let address: string
  if (typeof contractOrAddress == 'string') {
    address = contractOrAddress
  } else {
    address = contractOrAddress.address
  }
  await ethers.provider.getSigner().sendTransaction({to: address, value: parseEther('1')})
}

export async function getBalance(address:string): Promise<number> {
  const balance = await ethers.provider.getBalance(address)
  return parseInt(balance.toString())
}

export async function getTokenBalance(token: IERC20, address:string): Promise<number> {
  const balance = await token.balanceOf(address)
  return parseInt(balance.toString())
}


export function createWalletOwner(privkeyBase: string): Wallet {
  return new ethers.Wallet('0x'.padEnd(66, privkeyBase), ethers.provider);
}