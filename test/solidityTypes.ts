// define the same export types as used by export typechain/ethers
import { BytesLike } from "@ethersproject/bytes";
import { BigNumberish } from "ethers";

export type address = string;
export type uint256 = BigNumberish;
export type uint = BigNumberish;
export type uint48 = BigNumberish;
export type bytes = BytesLike;
export type bytes32 = BytesLike;
