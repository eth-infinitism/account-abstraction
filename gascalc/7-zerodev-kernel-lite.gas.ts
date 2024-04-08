import { GasCheckCollector, GasChecker } from './GasChecker'
import { createAccountOwner } from '../test/testutils'
import { ethers } from 'hardhat'
import { readFileSync } from 'fs'
import { BigNumberish } from 'ethers'
import { defaultAbiCoder, Interface } from 'ethers/lib/utils'
import { log } from 'console'
// TODO: NOTE: Must be executed separately as otherwise test will reuse SimpleAccount
context.only('simple account', function () {
  this.timeout(60000)
  const g = new GasChecker()

  const kernelDir = __dirname + '/../../zerodev-kernel'
  const accounts = JSON.parse(readFileSync(kernelDir + '/deployed.txt', 'ascii'))
  const zkLite0 = accounts.address0
  const zkLite1 = accounts.address1

  const kernelLiteFactory = JSON.parse(readFileSync(kernelDir + '/deployments//localhost/KernelFactory.json', 'ascii')).address
  const ECDSAValidator = JSON.parse(readFileSync(kernelDir + '/deployments//localhost/ECDSAValidator.json', 'ascii')).address
  const kernelLiteECDSA = JSON.parse(readFileSync(kernelDir + '/deployments//localhost/KernelLiteECDSA.json', 'ascii')).address
  const kernelFunctions = new Interface([
    'function createAccount(address,bytes,uint256)',
    'function execute(address,uint256,bytes,uint8)',
    'function executeBatch((address,uint256,bytes)[])',
    'function initialize(address,bytes)'
  ])

  let globalSalt = 10000
  const factoryInfo = async (owner: string, salt: string): Promise<any> => {
    const initData = kernelFunctions.encodeFunctionData(
      'initialize', [ECDSAValidator, owner])

    console.log('create factoryinfo for ', owner, 'salt=', ++globalSalt)
    const ret = {
      factory: kernelLiteFactory,
      factoryData: kernelFunctions.encodeFunctionData('createAccount', [kernelLiteECDSA, initData, globalSalt.toString()])
    }
    console.log('factoryInfo= ', ret)
    return ret
  }

  const execInfo = (target: string, value: BigNumberish, data: string): string =>
    kernelFunctions.encodeFunctionData('execute', [target, value, data, 0])

  // deployed by 'hardhat deploy' command in Zerodev repo fork

  before(async function () {
    await GasCheckCollector.init()
    GasCheckCollector.inst.createJsonResult = true
    const zerodevKernelOwner = createAccountOwner(1000)
    console.log('zerodevKernelOwner= ', zerodevKernelOwner.address)
    await g.insertAccount(zkLite0, zerodevKernelOwner)
    await g.insertAccount(zkLite1, zerodevKernelOwner)
    GasCheckCollector.inst.setContractName(zkLite0, 'ERC1967Proxy')
    GasCheckCollector.inst.setContractName(zkLite1, 'ERC1967Proxy')
    // todo: read this from deployed
    GasCheckCollector.inst.setContractName(ECDSAValidator, 'ECDSAValidator')
    GasCheckCollector.inst.setContractName(kernelLiteECDSA, 'KernelLiteECDSA')
    GasCheckCollector.inst.setContractName(kernelLiteFactory, 'KernelFactory')

    await ethers.provider.getSigner().sendTransaction({ to: zkLite0, value: 1e18.toString() })
    await ethers.provider.getSigner().sendTransaction({ to: zkLite1, value: 1e18.toString() })
  })

  it('simple 1', async function () {
    await g.addTestRow({
      title: 'zd-kernel-lite',
      count: 1,
      factoryInfo,
      execInfo,
      skipAccountCreation: true,
      appendZerodevMode: true,
      diffLastGas: false
    })
    await g.addTestRow({
      title: 'zd-kernel-lite - diff from previous',
      count: 2,
      factoryInfo,
      execInfo,
      skipAccountCreation: true,
      appendZerodevMode: true,
      diffLastGas: true
    })
  })
})
