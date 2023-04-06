import { ethers } from 'hardhat'
import { Signer } from 'ethers'
import {
  TSPAccount,
  TSPAccountFactory__factory,
  TSPAccount__factory, TSPAccountFactory,
  Guardian
} from '../typechain'
export * from './testutils'

export const DefaultPlatformGuardian = ethers.provider.getSigner().getAddress()

export const DefaultThreshold = 1

export const DefaultDelayBlock = 100

// given the parameters as AccountDeployer, return the resulting "counterfactual address" that it would create.
export async function getAccountAddress (owner: string, guardian: string, threshold: number, delay: number, guardians: string[], factory: TSPAccountFactory, salt = 0): Promise<string> {
  return await factory.getAddress(owner, salt, guardian, threshold, delay, guardians)
}

// Deploys an implementation and a proxy pointing to this implementation
export async function createTSPAccount (
  ethersSigner: Signer,
  accountOwner: string,
  entryPoint: string,
  guardian: Guardian,
  _factory?: TSPAccountFactory
):
  Promise<{
    proxy: TSPAccount
    accountFactory: TSPAccountFactory
    implementation: string
  }> {
  const accountFactory = _factory ?? await new TSPAccountFactory__factory(ethersSigner).deploy(entryPoint)
  const implementation = await accountFactory.accountImplementation()
  await accountFactory.createAccount(accountOwner, 0, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
  const accountAddress = await accountFactory.getAddress(accountOwner, 0, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
  const proxy = TSPAccount__factory.connect(accountAddress, ethersSigner)
  return {
    implementation,
    accountFactory,
    proxy
  }
}

// Deploys an implementation and a proxy pointing to this implementation
export async function createTSPAccountAndRegister (
  ethersSigner: Signer,
  accountOwner: string,
  entryPoint: string,
  guardian: Guardian,
  _factory?: TSPAccountFactory
):
  Promise<{
    proxy: TSPAccount
    accountFactory: TSPAccountFactory
    implementation: string
  }> {
  const accountFactory = _factory ?? await new TSPAccountFactory__factory(ethersSigner).deploy(entryPoint)
  const implementation = await accountFactory.accountImplementation()
  await accountFactory.createAccount(accountOwner, 0, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
  const accountAddress = await accountFactory.getAddress(accountOwner, 0, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
  const proxy = TSPAccount__factory.connect(accountAddress, ethersSigner)
  // await guardian.register(accountAddress)

  return {
    implementation,
    accountFactory,
    proxy
  }
}

// export async function registerGuardian(account: string, provider = ethers.provider): Promise<{
//   bool: boolean
// }> {
//   let bool = false;
//   Guardian__factory.connect(account, provider.getSigner());
//   return {
//     bool,
//   }
// }
