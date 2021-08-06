import {ethers} from "hardhat";
import {parseEther} from "ethers/lib/utils";

export const AddressZero = ethers.constants.AddressZero
export const ONE_ETH = parseEther('1');

export const tostr = (x:any) => x!=null ? x.toString() : 'null'