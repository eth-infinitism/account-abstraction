import "@nomiclabs/hardhat-waffle"
import "@typechain/hardhat";
import {HardhatUserConfig, subtask, task} from "hardhat/config";

import {TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD} from "hardhat/builtin-tasks/task-names"
import path from 'path'
import * as fs from "fs";
import {formatEther} from "ethers/lib/utils";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: any, hre, runSuper) => {
  const solcVersion = args.solcVersion
  if (solcVersion.indexOf('0.8.8') < 0)
    return runSuper();

  let ver = '0.8.7-nightly.2021.8.9+commit.74c804d8'
  const compilerPath = path.join(__dirname, `./compilers/soljson-v${ver}.js`)
  if (!fs.existsSync(compilerPath)) {
    throw `Unable to find: ${compilerPath}`
  }

  return {
    compilerPath,
    isSolcJs: true, // if you are using a native compiler, set this to false
    version: '0.8.7',
    // this is used as extra information in the build-info files, but other than
    // that is not important
    longVersion: '0.8.7+nightly'
  }
})

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
  formatEther(1)
})

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.7",
    settings: {
      optimizer: { enabled: false }
    }
  },
  networks: {
	dev: { url: "http://localhost:8545" }
  }
}
export default config
