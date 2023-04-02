import { Wallet, Signer } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  TSPAccount,
  Guardian,
  Guardian__factory
} from '../typechain'
import {
  createAccountOwner,
  createAccountAndRegister,
  rethrow,
  createAccount,
  DefaultDelayBlock, DefaultPlatformGuardian, DefaultThreshold
} from './tsp-utils.test'

describe('Guardian', function () {
  const entryPoint = '0x'.padEnd(42, '2')
  let accounts: string[]
  let ownerGuardian: Guardian
  let accountOwner: Wallet
  let tspAccount: TSPAccount
  let signers: Signer[]
  const ethersSigner = ethers.provider.getSigner()

  before(async function () {
    accounts = await ethers.provider.listAccounts()
    // ignore in geth.. this is just a sanity test. should be refactored to use a single-account mode..
    if (accounts.length < 2) this.skip()
    signers = await ethers.getSigners()
    const _guardian = await new Guardian__factory(ethersSigner).deploy(DefaultThreshold, DefaultDelayBlock, DefaultPlatformGuardian)
    ownerGuardian = await Guardian__factory.connect(_guardian.address, accountOwner)
    accountOwner = createAccountOwner()
    const { proxy: tspAccount } = await createAccount(ethers.provider.getSigner(), accountOwner.address, entryPoint)
    await ownerGuardian.register(tspAccount.address)
  })

  it('any address should be able to call register', async () => {
    // accounts[0] is owner, owner makes the platform its guardian
    const { proxy: account } = await createAccount(ethers.provider.getSigner(), accounts[0], entryPoint)
    await ownerGuardian.register(account.address)
    const config = await ownerGuardian.getGuardianConfig(tspAccount.address)
    expect(config.guardians[0]).to.equals(await DefaultPlatformGuardian)
  })

  it('an account cannot be registered multiple times', async () => {
    // stop 3 seconds
    const g1: Guardian = await Guardian__factory.connect(ownerGuardian.address, accountOwner)
    await expect(g1.register(tspAccount.address).catch(rethrow())).to.revertedWith('a TSP account can only be registered once')
  })

  it('account owner should be able to config account guardians', async () => {
    const config = await ownerGuardian.getGuardianConfig(tspAccount.address)
    expect(config.guardians[0]).to.equals(await DefaultPlatformGuardian)
    const guardians = [...config.guardians, accounts[3]]
    await ownerGuardian.setConfig(tspAccount.address, { guardians: guardians, approveThreshold: DefaultThreshold, delay: DefaultDelayBlock })
    const newConfig = await ownerGuardian.getGuardianConfig(tspAccount.address)
    // console.log("new config", newConfig, accounts[3]);
    await expect(newConfig.guardians[1]).to.equals(accounts[3])
  })

  describe('Guardian Approved', function () {
    let tspAccount: TSPAccount
    const g1: Signer = signers[3]
    const g2: Signer = signers[4]
    const g3: Signer = signers[5]
    before('create new account', async () => {
      const { proxy: tspAccount } = await createAccountAndRegister(ethersSigner, accounts[2], entryPoint, ownerGuardian)
      await ownerGuardian.setConfig(tspAccount.address, { guardians: [g1.getAddress(), g2.getAddress(), g3.getAddress()], approveThreshold: 10, delay: 100 })
    })

    it('account guardian should be able to approve reset', async () => {
      const newConfig = await ownerGuardian.getGuardianConfig(tspAccount.address)
      // console.log("new config", newConfig, accounts[3]);
      await expect(newConfig.guardians[1]).to.equals(accounts[3])
    })

    it('other EOA should not be able to approve reset', async () => {

    })

    it('account guardian should be able to reset account owner', async () => {

    })

    it('owner should be able to call transfer owner, and origin owner not be able to call', async () => {
      // guardian.transferOwnership();

    })

    it('other owner should not be able to call transfer owner', async () => {

    })
  })
})
