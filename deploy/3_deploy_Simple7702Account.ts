import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const deploySimple7702Account: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  const from = await provider.getSigner().getAddress()

  // Get the deployed EntryPoint address
  const entryPointDeployment = await hre.deployments.get('EntryPoint')
  const entryPointAddress = entryPointDeployment.address

  await hre.deployments.deploy(
    'Simple7702Account', {
      from,
      args: [entryPointAddress],
      gasLimit: 6e6,
      deterministicDeployment: true,
      log: true
    })
}

export default deploySimple7702Account
