import { Wallet, Signer } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  TSPAccount,
  TSPAccountFactory__factory,
  TestUtil,
  TestUtil__factory,
  Guardian,
  Guardian__factory
} from '../typechain'
import {
  createAddress,
  createAccountOwner,
  createAccountAndRegister,
  getBalance,
  isDeployed,
  ONE_ETH,
  rethrow,
  createAccount, HashZero,
  DefaultDelayBlock, DefaultPlatformGuardian, DefaultThreshold
} from './tsp-utils.test'
import { fillUserOpDefaults, getUserOpHash, packUserOp, signUserOp } from './UserOp'
import { parseEther } from 'ethers/lib/utils'
import { UserOperation } from './UserOperation'

describe('Guardian', function () {
  const entryPoint = '0x'.padEnd(42, '2')
  let accounts: string[]
  let testUtil: TestUtil
  let ownerGuardian: Guardian
  let accountOwner: Wallet
  let tspAccount: TSPAccount
  let signers: Signer[]
  const ethersSigner = ethers.provider.getSigner()

  before(async function () {
    accounts = await ethers.provider.listAccounts()
    // ignore in geth.. this is just a sanity test. should be refactored to use a single-account mode..
    if (accounts.length < 2) this.skip()
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    signers = await ethers.getSigners();
    let _guardian = await new Guardian__factory(ethersSigner).deploy(DefaultThreshold, DefaultDelayBlock, DefaultPlatformGuardian)
    ownerGuardian = await Guardian__factory.connect(_guardian.address, accountOwner);
    accountOwner = createAccountOwner()
    const { proxy: tspAccount } = await createAccount(ethers.provider.getSigner(), accountOwner.address, entryPoint)
    await ownerGuardian.register(tspAccount.address);
  })

  it("any address should be able to call register", async () => {
    // accounts[0] is owner, owner makes the platform its guardian 
    let { proxy: account } = await createAccount(ethers.provider.getSigner(), accounts[0], entryPoint)
    await ownerGuardian.register(account.address);
    let config = await ownerGuardian.getGuardianConfig(tspAccount.address);
    expect(config.guardians[0]).to.equals(await DefaultPlatformGuardian);
  });

  it("an account cannot be registered multiple times", async () => {
    // stop 3 seconds 
    let g1: Guardian = await Guardian__factory.connect(ownerGuardian.address, accountOwner);
    await expect(g1.register(tspAccount.address).catch(rethrow())).to.revertedWith('a TSP account can only be registered once')
  });


  it("account owner should be able to config account guardians", async () => {
    let config = await ownerGuardian.getGuardianConfig(tspAccount.address);
    expect(config.guardians[0]).to.equals(await DefaultPlatformGuardian);
    let guardians = [...config.guardians, accounts[3]];
    await ownerGuardian.setConfig(tspAccount.address, { guardians: guardians, approveThreshold: DefaultThreshold, delay: DefaultDelayBlock });
    let newConfig = await ownerGuardian.getGuardianConfig(tspAccount.address);
    // console.log("new config", newConfig, accounts[3]);
    await expect(newConfig.guardians[1]).to.equals(accounts[3]);
  });

  describe("Guardian Approved", async () => {
    let tspAccount: TSPAccount
    let g1: Signer = signers[3]
    let g2: Signer = signers[4]
    let g3: Signer = signers[5]
    before("create new account", async () => {
      let { proxy: tspAccount } = await createAccountAndRegister(ethersSigner, accounts[2], entryPoint, ownerGuardian);
      await ownerGuardian.setConfig(tspAccount.address, { guardians: [g1.getAddress(), g2.getAddress(), g3.getAddress()], approveThreshold: 10, delay: 100 });
    });

    it("account guardian should be able to approve reset", async () => {
      let newConfig = await ownerGuardian.getGuardianConfig(tspAccount.address);
      // console.log("new config", newConfig, accounts[3]);
      await expect(newConfig.guardians[1]).to.equals(accounts[3]);
    });

    it("other EOA should not be able to approve reset", async () => {

    });

    it("account guardian should be able to reset account owner", async () => {

    });

  });



  it("owner should be able to call transfer owner, and origin owner not be able to call", async () => {
    // guardian.transferOwnership();
  });

  it("other owner should not be able to call transfer owner", async () => {

  });


})
