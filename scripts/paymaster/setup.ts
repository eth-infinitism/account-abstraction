import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import "dotenv/config";
import { ethers } from "hardhat";

import { TokenPaymaster__factory } from "../../contracts/types";

async function main() {
  const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS;
  const ACCOUNT_ADDRESS = process.env.ACCOUNT_ADDRESS;

  // account check
  const deployer = (await ethers.getSigners())[0] as SignerWithAddress;
  const balance = (await deployer.getBalance()).toString();
  console.log("calling contract with the account:", deployer.address);
  console.log("account balance:", balance);

  // TokenPaymaster
  const paymaster = TokenPaymaster__factory.connect(
    PAYMASTER_ADDRESS!,
    deployer,
  );

  // stake 0.1 ETH from Paymaster to EntryPoint
  const addStakeTx = await paymaster
    .connect(deployer)
    .addStake(1, { value: ethers.utils.parseEther("0.1") });
  console.log("complete to addStake. tx hash:", addStakeTx.hash);

  // deposit 0.1 ETH from Paymaster to EntryPoint
  const depositTx = await paymaster
    .connect(deployer)
    .deposit({ value: ethers.utils.parseEther("0.1") });
  console.log("complete to deposit. tx hash:", depositTx.hash);

  // mint 1 HOGE to account
  const mintTx = await paymaster
    .connect(deployer)
    .mintTokens(ACCOUNT_ADDRESS!, ethers.utils.parseEther("1"));
  console.log("complete to mintTokens. tx hash:", mintTx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
