import { ethers } from "ethers";

// @ts-ignore
import config from "../../config.json";
import {
  ERC20_ABI,
  getGasFee,
  getHttpRpcClient,
  getSimpleAccount,
  getVerifyingPaymaster,
  printOp,
} from "../../src";

export default async function main(
  tkn: string,
  t: string,
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

  const token = ethers.utils.getAddress(tkn);
  const to = ethers.utils.getAddress(t);
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([
    erc20.symbol(),
    erc20.decimals(),
  ]);
  const amount = ethers.utils.parseUnits(amt, decimals);
  console.log(`Transferring ${amt} ${symbol as string}...`);

  const op = await accountAPI.createSignedUserOp({
    target: erc20.address,
    data: erc20.interface.encodeFunctionData("transfer", [to, amount]),
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
