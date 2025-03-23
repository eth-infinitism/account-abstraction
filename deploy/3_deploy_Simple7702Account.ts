import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const deployEntryPoint: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  const from = await provider.getSigner().getAddress()

  const ret = await hre.deployments.deploy(
    'Simple7702Account', {
      from,
      args: [],
      gasLimit: 6e6,
      deterministicDeployment: true,
      log: true
    })
}

export default deployEntryPoint
