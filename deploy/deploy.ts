import deployEntryPoint from "./1_deploy_entrypoint";
import deploySimpleAccountFactory from "./2_deploy_SimpleAccountFactory";
import hre from "hardhat";
async function main() {
  await deployEntryPoint(hre);
  await deploySimpleAccountFactory(hre);
}
main();
