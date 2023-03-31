import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const deployGuardian: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  const from = await provider.getSigner().getAddress()

  const ret = await hre.deployments.deploy(
    'Guardian', {
      from,
      args: [1, 100, 0x0],
      gasLimit: 6e6,
      deterministicDeployment: true
    })
  console.log('==Guardian addr=', ret.address)
}

export default deployGuardian
