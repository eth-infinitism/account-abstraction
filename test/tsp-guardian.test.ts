import { Wallet, Signer } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { parseEther } from 'ethers/lib/utils'
import {
  TSPAccount,
  Guardian,
  Guardian__factory
} from '../typechain'
import {
  createAccountOwner,
  createTSPAccountAndRegister,
  rethrow,
  createTSPAccount,
  DefaultDelayBlock, DefaultPlatformGuardian, DefaultThreshold
} from './tsp-utils.test'

describe('Guardian', function () {
  const entryPoint = '0x'.padEnd(42, '2')
  let accounts: string[]
  let guardian: Guardian
  let accountOwner: Wallet
  let tspAccount: TSPAccount
  let signers: Signer[]
  const ethersSigner = ethers.provider.getSigner()

  before(async function () {
    accounts = await ethers.provider.listAccounts()
    // console.log('accounts', accounts)
    // ignore in geth.. this is just a sanity test. should be refactored to use a single-account mode..
    if (accounts.length < 2) this.skip()
    signers = await ethers.getSigners()
    accountOwner = createAccountOwner()
    const _guardian = await new Guardian__factory(ethersSigner).deploy(DefaultThreshold, DefaultDelayBlock, DefaultPlatformGuardian)
    guardian = await Guardian__factory.connect(_guardian.address, accountOwner)
    const act = await createTSPAccount(ethers.provider.getSigner(), accountOwner.address, entryPoint)
    tspAccount = act.proxy
    // console.log('tsp account', tspAccount.address)
    await ethersSigner.sendTransaction({ from: accounts[0], to: accountOwner.address, value: parseEther('2') })
    await guardian.register(tspAccount.address, { gasLimit: 10000000 })
  })

  it('any address should be able to call register', async () => {
    // accounts[0] is owner, owner makes the platform its guardian
    const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[1], entryPoint)
    await guardian.register(account.address, { gasLimit: 10000000 })
    const config = await guardian.getGuardianConfig(account.address)
    expect(config.guardians[0]).to.equals(await DefaultPlatformGuardian)
  })

  it('an account cannot be registered multiple times', async () => {
    // stop 3 seconds
    const g1: Guardian = await Guardian__factory.connect(guardian.address, accountOwner)
    await expect(g1.register(tspAccount.address).catch(rethrow())).to.revertedWith('a TSP account can only be registered once')
  })

  it('account owner should be able to config account guardians', async () => {
    const config = await guardian.getGuardianConfig(tspAccount.address)
    expect(config.guardians[0]).to.equals(await DefaultPlatformGuardian)
    const guardians = [...config.guardians, accounts[3]]
    await guardian.setConfig(tspAccount.address, { guardians: guardians, approveThreshold: DefaultThreshold, delay: DefaultDelayBlock })
    const newConfig = await guardian.getGuardianConfig(tspAccount.address)
    // console.log("new config", newConfig, accounts[3]);
    await expect(newConfig.guardians[1]).to.equals(accounts[3])
  })

  describe('Guardian Approved', function () {
    let newAccount: TSPAccount
    let g1: Signer
    let g2: Signer
    let g3: Signer
    let newOwner: Signer
    before('create new account', async () => {
      g1 = signers[3]
      g2 = signers[4]
      g3 = signers[5]
      newOwner = signers[6]
      const act = await createTSPAccountAndRegister(ethersSigner, accounts[2], entryPoint, guardian)
      newAccount = act.proxy
      await guardian.connect(signers[2]).setConfig(newAccount.address, { guardians: [g1.getAddress(), g2.getAddress(), g3.getAddress()], approveThreshold: 10, delay: 100 }, { gasLimit: 10000000 })
    })

    it('account guardian should be able to approve reset', async () => {
      // const newConfig = await ownerGuardian.getGuardianConfig(newAccount.address)
      await guardian.connect(g1).approve(newAccount.address, newOwner.getAddress(), { gasLimit: 10000000 })
    })

    // it('other EOA should not be able to approve reset', async () => {
    //   const _guardian = await guardian.connect(signers[7])
    //   // await _guardian.approve(newAccount.address, newOwner.getAddress())
    //   await expect(_guardian.approve(newAccount.address, newOwner.getAddress()).catch(rethrow())).to.revertedWith('Error: Error(you are not a guardian)')
    // })

    it('any EOA should be able to reset account owner', async () => {
      const act = await createTSPAccountAndRegister(ethersSigner, accounts[2], entryPoint, guardian)
      const _account = act.proxy
      await _account.connect(ethers.provider.getSigner(2)).changeGuardian(guardian.address, { gasLimit: 10000000 })
      expect(await _account.getGuardian()).to.be.equals(guardian.address)
      await guardian.connect(ethers.provider.getSigner(2)).setConfig(_account.address, { guardians: [g1.getAddress(), g2.getAddress(), g3.getAddress()], approveThreshold: 50, delay: 1 }, { gasLimit: 10000000 })
      const _newOwner = await newOwner.getAddress()
      await guardian.connect(g1).approve(_account.address, _newOwner, { gasLimit: 10000000 })
      await guardian.connect(g2).approve(_account.address, _newOwner, { gasLimit: 10000000 })
      await guardian.connect(g3).approve(_account.address, _newOwner, { gasLimit: 10000000 })
      await guardian.connect(signers[7]).resetAccountOwner(_account.address, { gasLimit: 10000000 })
      const _owner = await _account.owner()
      expect(_owner).to.equal(_newOwner)
    })

    it('the threshold value has not been reached, unable to reset the account', async () => {
      const act = await createTSPAccountAndRegister(ethersSigner, accounts[6], entryPoint, guardian)
      const _account = act.proxy
      await _account.connect(ethers.provider.getSigner(6)).changeGuardian(guardian.address, { gasLimit: 10000000 })
      await guardian.connect(ethers.provider.getSigner(6)).setConfig(_account.address, { guardians: [g1.getAddress(), g2.getAddress(), g3.getAddress()], approveThreshold: 50, delay: 1 }, { gasLimit: 10000000 })
      await guardian.connect(g1).approve(_account.address, accounts[7], { gasLimit: 10000000 })
      await guardian.connect(g2).approve(_account.address, accounts[7], { gasLimit: 10000000 })
      const { progress } = await guardian.getApproveProgress(_account.address)
      expect(progress).to.equals(66)
      await guardian.connect(g2).resetAccountOwner(_account.address, { gasLimit: 10000000 })
      expect(accounts[7]).to.equals(await _account.owner())
    })

    it('only the account owner can be clean approves', async () => {
      const act = await createTSPAccountAndRegister(ethersSigner, accounts[7], entryPoint, guardian)
      const _account = act.proxy
      await guardian.connect(ethers.provider.getSigner(7)).setConfig(_account.address, { guardians: [g1.getAddress(), g2.getAddress(), g3.getAddress()], approveThreshold: 50, delay: 100 }, { gasLimit: 10000000 })
      await guardian.connect(g1).approve(_account.address, accounts[8], { gasLimit: 10000000 })
      await guardian.connect(g2).approve(_account.address, accounts[8], { gasLimit: 10000000 })
      const { progress } = await guardian.getApproveProgress(_account.address)
      expect(progress).to.equals(66)
      await guardian.connect(ethers.provider.getSigner(7)).clearApproves(_account.address, { gasLimit: 10000000 })
      const { progress: progress2 } = await guardian.getApproveProgress(_account.address)
      expect(progress2).to.equals(0)
    })

    it('the owner cannot be reset for blocks that have not reached the delayed effect', async () => {
      const act = await createTSPAccountAndRegister(ethersSigner, accounts[9], entryPoint, guardian)
      const _account = act.proxy
      await guardian.connect(ethers.provider.getSigner(9)).setConfig(_account.address, { guardians: [g1.getAddress(), g2.getAddress(), g3.getAddress()], approveThreshold: 50, delay: 100 }, { gasLimit: 10000000 })
      await guardian.connect(g1).approve(_account.address, accounts[10], { gasLimit: 10000000 })
      await guardian.connect(g2).approve(_account.address, accounts[10], { gasLimit: 10000000 })
      const { progress } = await guardian.getApproveProgress(_account.address)
      expect(progress).to.equals(66)
      await expect(guardian.resetAccountOwner(_account.address, { gasLimit: 10000000 }).catch(rethrow())).to.revertedWith('the delay reset time has not yet reached')
    })
  })

  it('owner should be able to call transfer owner, and origin owner not be able to call', async () => {
    // guardian.transferOwnership();
    const _guardian = await new Guardian__factory(ethersSigner).deploy(DefaultThreshold, DefaultDelayBlock, DefaultPlatformGuardian)
    await _guardian.transferOwnership(signers[8].getAddress(), { gasLimit: 10000000 })
    const _owner = await _guardian.owner()
    await expect(_owner).to.equal(accounts[8])
  })

  it('other owner should not be able to call transfer owner', async () => {
    const _guardian = await new Guardian__factory(ethersSigner).deploy(DefaultThreshold, DefaultDelayBlock, DefaultPlatformGuardian)
    const _connet = await _guardian.connect(signers[9])
    await expect(_connet.transferOwnership(signers[8].getAddress(), { gasLimit: 10000000 }).catch(rethrow())).to.revertedWith('Ownable: caller is not the owner')
  })
})
