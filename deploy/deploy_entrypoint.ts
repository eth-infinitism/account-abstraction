import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { Create2Factory } from '../src/Create2Factory'
import { ethers } from 'hardhat'

const UNSTAKE_DELAY_SEC = 86400
const PAYMASTER_STAKE = ethers.utils.parseEther('1')

const deployEntryPoint: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider
  const from = await provider.getSigner().getAddress()
  await new Create2Factory(ethers.provider).deployFactory()

  const ret = await hre.deployments.deploy(
    'EntryPoint', {
      from,
      args: [PAYMASTER_STAKE, UNSTAKE_DELAY_SEC],
      gasLimit: 4e6,
      deterministicDeployment: true
    })
  console.log('==entrypoint addr=', ret.address)
  const entryPointAddress = ret.address

  const w = await hre.deployments.deploy(
    'SimpleWallet', {
      from,
      args: [entryPointAddress, from],
      gasLimit: 2e6,
      deterministicDeployment: true
    })

  console.log('== wallet=', w.address)

  const t = await hre.deployments.deploy('TestCounter', {
    from,
    deterministicDeployment: true
  })
  console.log('==testCounter=', t.address)
}

export default deployEntryPoint
