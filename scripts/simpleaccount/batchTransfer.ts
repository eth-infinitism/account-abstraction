import { ethers } from "ethers";

// @ts-ignore
import config from "../../config.json";
import {
  getGasFee,
  getHttpRpcClient,
  getSimpleAccount,
  getVerifyingPaymaster,
  printOp,
} from "../../src";

// This example requires several layers of calls:
// EntryPoint
//  ┕> sender.executeBatch
//    ┕> sender.execute (recipient 1)
//    ⋮
//    ┕> sender.execute (recipient N)
export default async function main(
  t: Array<string>,
  amt: string,
  withPM: boolean,
) {
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const paymasterAPI = withPM
    ? getVerifyingPaymaster(config.paymasterUrl, config.entryPoint)
    : undefined;
  const accountAPI = getSimpleAccount(
    provider,
    config.signingKey,
    config.entryPoint,
    config.simpleAccountFactory,
    paymasterAPI,
  );
  const sender = await accountAPI.getCounterFactualAddress();

  const ac = await accountAPI._getAccountContract();
  const value = ethers.utils.parseEther(amt);
  let dest: Array<string> = [];
  let data: Array<string> = [];
  t.map((addr) => addr.trim()).forEach((addr) => {
    dest = [...dest, sender];
    data = [
      ...data,
      ac.interface.encodeFunctionData("execute", [
        ethers.utils.getAddress(addr),
        value,
        "0x",
      ]),
    ];
  });

  const op = await accountAPI.createSignedUserOp({
    target: sender,
    data: ac.interface.encodeFunctionData("executeBatch", [dest, data]),
    ...(await getGasFee(provider)),
  });
  console.log(`Signed UserOperation: ${await printOp(op)}`);

  const client = await getHttpRpcClient(
    provider,
    config.bundlerUrl,
    config.entryPoint,
  );
  const uoHash = await client.sendUserOpToBundler(op);
  console.log(`UserOpHash: ${uoHash}`);

  console.log("Waiting for transaction...");
  const txHash = await accountAPI.getUserOpReceipt(uoHash);
  console.log(`Transaction hash: ${txHash}`);
}
