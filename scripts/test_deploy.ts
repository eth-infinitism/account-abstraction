 import { ethers } from 'hardhat'
import { fund } from "../test/testutils";
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import createUserOp from './test_createUserOp'

import addTemporaryOwner from './test_addTemporaryOwner'
import { 
  TestExpiryAccount,
  TestCounter,
  TestCounter__factory,
  TestExpiryAccountFactory
} from '../typechain'

const hre: HardhatRuntimeEnvironment = require("hardhat")

// Global Entrypoint contract for goerli testnet
const entryPointAddr = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
// My account to get fees
const owner = '0x00a9D5448A1Ec8519F00AB503DdB485868638E3c'
const beneficiary = owner

async function main() {
    /*
    ==============Bringing Account Factory==============
    */
    console.log("deploy start")

    const network = await hre.ethers.provider.getNetwork()
    console.log("Network:", network.name)
   
    console.log('Bringing TestExpiryAccountFactory...')
    // Already deployed TestExpiryAccountFactory
    const accountFactory: TestExpiryAccountFactory = await ethers.getContractAt(
      'TestExpiryAccountFactory',
      "0x9e80341a8ac50c35c92a19c5ad2de6fd30b61e18"
    )
    
    /*
    ==============Deploying Account By calling AccountFactory directly==============
    */
    

    console.log('Deploying TestExpiryAccount...')
    // should modify salt to random number at every time testing 
    const tx = await accountFactory.createAccount(owner, 1265, {gasPrice: 5e5})
    await tx.wait()
    const accountAddress = await accountFactory.callStatic.getAddress(owner, 1265)
    console.log('TestExpiryAccount Deployed', accountAddress)
    
    /*
    ==============Calling addTemporaryOwner() Function==============
    */
    console.log('Add temporary owner...')
    const ethersSigner = hre.ethers.provider.getSigner()
    // Used TestCounter Contract as a targetmethod
    const counter = await new TestCounter__factory(ethersSigner).deploy()
    const count = counter.interface.encodeFunctionData('count')
    const targetMethods : TestExpiryAccount.TargetMethodsStruct[] = [
      {
        delegatedContract: counter.address,
        delegatedFunctions: [
          count 
        ]
      }
    ];
    const provider = await ethers.getDefaultProvider("goerli", {
      etherscan: process.env.ETHERSCAN_API_KEY,
    });
    const signer = new hre.ethers.Wallet(`${process.env.TEST_ACCOUNT}`, provider)
    const txhash1 = await addTemporaryOwner(accountAddress, targetMethods, signer.address)
    console.log(`Added ${signer.address} as a temporary owner, tx hash is:`, txhash1)
    
    //deposit 1 ETH to SCW
    console.log("Funding ....");
    await fund(accountAddress); 

    /*
    ==============Testing handleOps() through entrypoint==============
    */
    console.log(`Test UserOp signed by ${signer.address}`)
    const account = await ethers.getContractAt('TestExpiryAccount', accountAddress)
    const txhash2 = await createUserOp(entryPointAddr, signer, counter, account, beneficiary)
    console.log('Test Ended, txhash is: ', txhash2)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });