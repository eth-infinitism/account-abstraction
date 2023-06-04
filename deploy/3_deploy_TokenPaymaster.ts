import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const deplyoTokenPaymaster: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  // const from = await provider.getSigner().getAddress()
  const from = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
  const network = await provider.getNetwork()
  // only deploy on local test network.
  // if (network.chainId !== 31337 && network.chainId !== 1337) {
  //   return
  // }

  const entrypoint = await hre.deployments.get('EntryPoint')
  const accountFactory = await hre.deployments.get('SimpleAccountFactory')
  const ret = await hre.deployments.deploy(
    'TokenPaymaster', {
      from,
      args: [accountFactory.address, "ot", entrypoint.address],
      gasLimit: 6e6,
      log: true//,
      // deterministicDeployment: true
    })
  console.log('==TokenPaymaster addr=', ret.address)
}

export default deplyoTokenPaymaster
