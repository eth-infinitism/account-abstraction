import "@nomiclabs/hardhat-waffle"
import "@typechain/hardhat";
import {HardhatUserConfig, subtask, task} from "hardhat/config";
import 'hardhat-deploy'
import '@nomiclabs/hardhat-etherscan'
import {TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD} from "hardhat/builtin-tasks/task-names"
import path from 'path'
import "hardhat-gas-reporter"

import 'solidity-coverage'

import * as fs from "fs";

let mnemonicFileName = process.env.MNEMONIC_FILE || process.env.HOME + '/.secret/testnet-mnemonic.txt'
let mnemonic = 'test '.repeat(11) + 'junk'
if (fs.existsSync(mnemonicFileName))
  mnemonic = fs.readFileSync(mnemonicFileName!, "ascii");


console.log(mnemonic)

function getNetwork1(url: string) {
  return {
    url,
    accounts: {mnemonic}
  }
}

function getNetwork(name: string) {
  return getNetwork1(`https://${name}.infura.io/v3/${process.env.INFURA_ID}`)
  // return getNetwork1(`wss://${name}.infura.io/ws/v3/${process.env.INFURA_ID}`)
}

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.12",
    settings: {
      optimizer: {enabled: true}
    }
  },
  networks: {
    dev: {url: "http://localhost:8545"},
    goerli: getNetwork('goerli'),
    proxy: getNetwork1('http://localhost:8545'),
    kovan: getNetwork('kovan')
  },
  mocha: {
    timeout: 10000
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },

  gasReporter: {
    enabled: process.env.GAS_REPORT != null,
    excludeContracts: ['TestUtil', 'TestToken', 'TestOracle', 'TestCounter', 'TestPaymasterAcceptAll', 'SimpleWallet', 'ERC20'],
    //"yarn gas-report" to dump report and create a no-color "txt" output, to be checked in.
    noColors: false,
    currency: '',
    outputFile: 'reports/gas-used-output.color'
  }
}

export default config
