import { PaymasterAPI, SimpleAccountAPI } from "@account-abstraction/sdk";
import { JsonRpcProvider } from "@ethersproject/providers";
import { ethers } from "ethers";

export function getSimpleAccount(
  provider: JsonRpcProvider,
  signingKey: string,
  entryPointAddress: string,
  factoryAddress: string,
  paymasterAPI?: PaymasterAPI,
) {
  const owner = new ethers.Wallet(signingKey, provider);
  const sw = new SimpleAccountAPI({
    provider,
    entryPointAddress,
    owner,
    factoryAddress,
    paymasterAPI,
  });

  // Hack: default getUserOpReceipt does not include fromBlock which causes an error for some RPC providers.
  sw.getUserOpReceipt = async (
    userOpHash: string,
    timeout = 30000,
    interval = 5000,
  ): Promise<string | null> => {
    const endtime = Date.now() + timeout;
    const block = await sw.provider.getBlock("latest");
    while (Date.now() < endtime) {
      // @ts-ignore
      const events = await sw.entryPointView.queryFilter(
        // @ts-ignore
        sw.entryPointView.filters.UserOperationEvent(userOpHash),
        Math.max(0, block.number - 100),
      );
      if (events.length > 0) {
        return events[0].transactionHash;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return null;
  };

  return sw;
}
