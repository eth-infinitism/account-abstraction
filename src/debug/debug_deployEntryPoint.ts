import {EntryPoint, EntryPoint__factory} from "../../typechain-types";
import {Create2Factory} from "../Create2Factory";
import {BigNumberish, providers} from "ethers";
import {JsonRpcProvider} from "@ethersproject/providers";

export async function debug_deployEntryPoint(provider: JsonRpcProvider, paymasterStake: BigNumberish, unstakeDelaySecs: BigNumberish): Promise<EntryPoint> {
  await Create2Factory.init(provider)
  const factory = await new EntryPoint__factory(provider.getSigner())
  const entrypoint = await factory.deploy(Create2Factory.contractAddress, paymasterStake, unstakeDelaySecs)
  return entrypoint
}

