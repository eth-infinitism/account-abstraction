import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'

const deployTestToken: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  const from = await provider.getSigner().getAddress()

  const ret = await hre.deployments.deploy(
    'TestToken', {
      from,
      args: [],
      gasLimit: 8e8,
      deterministicDeployment: true
    })
  console.log('==TestToken addr=', ret.address)
  console.log('gas', ret.receipt?.cumulativeGasUsed)
}

export default deployTestToken
