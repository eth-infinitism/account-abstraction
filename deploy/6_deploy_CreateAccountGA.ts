import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const deploySimpleAccountFactory: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  const from = await provider.getSigner().getAddress()
  const network = await provider.getNetwork()
  // only deploy on local test network.
  // if (network.chainId !== 31337 && network.chainId !== 1337) {
  //   return
  // }

 
  const accountOwner = "0x7E71FB21D0B30F5669f8F387D4A1114294F8E418"
  console.log("hre.ethers", hre.ethers)
  const saf = await hre.ethers.getContract("SimpleAccountFactoryGA");
  console.log("saf", saf);
  saf.createAccount(accountOwner, 0)
  const accountAddress = await saf.getAddress(accountOwner, 0)
  
  console.log("==Created account GA ==", accountAddress);
}

export default deploySimpleAccountFactory
