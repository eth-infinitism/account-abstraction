import { providers, Wallet } from "ethers";

export async function getProvider() {
  return new providers.JsonRpcProvider("https://testnet-lifeaiv1-c648f.avax-test.network/ext/bc/62fkxYTWbGBfXoHNXcGJbq2dTXba2uoCFySzdHy87iovJj2F4/rpc?token=25e957a027b09bb006da7e9fc981100ce25f333cd998a76eb36a842fcb5ba63a");
}

export async function getWallet() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found");
  }

  const provider = await getProvider();
  return new Wallet(process.env.PRIVATE_KEY, provider);
}


export async function getUserWallet() {
  const provider = await getProvider();
  return new Wallet("fa1770325100e5a44539761a52a4a6c0ede14a600a41c92d3915855a983322ad", provider);
}