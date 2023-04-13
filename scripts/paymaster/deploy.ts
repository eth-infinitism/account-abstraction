import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import "dotenv/config";
import { ethers } from "hardhat";

async function main() {
  const ENTRY_POINT_ADDRESS = process.env.ENTRY_POINT_ADDRESS;
  const ACCOUNT_FACTORY_ADDRESS = process.env.ACCOUNT_FACTORY_ADDRESS;

  // account check
  const deployer = (await ethers.getSigners())[0] as SignerWithAddress;
  const balance = (await deployer.getBalance()).toString();
  console.log("deploying contract with the account:", deployer.address);
  console.log("account balance:", balance);

  // TokenPaymaster
  const TokenPaymaster = await ethers.getContractFactory("TokenPaymaster");
  const tokenPaymaster = await TokenPaymaster.deploy(
    ACCOUNT_FACTORY_ADDRESS!,
    "HOGE",
    ENTRY_POINT_ADDRESS!,
  );
  console.log("TokenPaymaster address:", tokenPaymaster.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
