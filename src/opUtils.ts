import { UserOperationStruct } from "@account-abstraction/contracts";
import { ethers } from "ethers";

export function toJSON(op: Partial<UserOperationStruct>): Promise<any> {
  return ethers.utils.resolveProperties(op).then((userOp) =>
    Object.keys(userOp)
      .map((key) => {
        let val = (userOp as any)[key];
        if (typeof val !== "string" || !val.startsWith("0x")) {
          val = ethers.utils.hexValue(val);
        }
        return [key, val];
      })
      .reduce(
        (set, [k, v]) => ({
          ...set,
          [k]: v,
        }),
        {},
      ),
  );
}

export async function printOp(
  op: Partial<UserOperationStruct>,
): Promise<string> {
  return toJSON(op).then((userOp) => JSON.stringify(userOp, null, 2));
}
