import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const deployGuardian: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  const from = await provider.getSigner().getAddress()

  const ret = await hre.deployments.deploy(
    'Guardian', {
      from,
      args: [],
      gasLimit: 2e8,
      deterministicDeployment: true
    })
  console.log('==Guardian addr=', ret.address)
  console.log('gas', ret.receipt?.cumulativeGasUsed)
}

export default deployGuardian
