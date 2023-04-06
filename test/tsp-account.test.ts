import { expect } from 'chai'
import { Wallet } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import {
  TSPAccount,
  TSPAccountFactory__factory,
  Guardian__factory,
  Guardian,
  TestUtil,
  TestUtil__factory,
  TSPAccount__factory
} from '../typechain'
import { fillUserOpDefaults, getUserOpHash, packUserOp, signUserOp } from './UserOp'
import { UserOperation } from './UserOperation'
import {
  AddressZero,
  HashZero,
  ONE_ETH,
  createAccountOwner,
  createAddress,
  createTSPAccount,
  getBalance,
  isDeployed,

  DefaultThreshold, DefaultDelayBlock, DefaultPlatformGuardian
} from './tsp-utils.test'

describe('TSPAccount', function () {
  const entryPoint = '0x'.padEnd(42, '2')
  let accounts: string[]
  let testUtil: TestUtil
  let accountOwner: Wallet
  let guardian: Guardian
  const ethersSigner = ethers.provider.getSigner()

  before(async function () {
    accounts = await ethers.provider.listAccounts()
    // accounts.forEach(element => {
    //   ethers.provider.getBalance(element).then((result) => {
    //     console.log(element, 'balance', formatEther(result.toString()))
    //   }).catch(e => {
    //     console.log(e)
    //   })
    // })
    // ignore in geth.. this is just a sanity test. should be refactored to use a single-account mode..
    if (accounts.length < 2) this.skip()
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    accountOwner = createAccountOwner()
    guardian = await new Guardian__factory(ethersSigner).deploy()
  })

  it('tspaccount deploy', async () => {
    const _account = await new TSPAccount__factory(ethersSigner).deploy(entryPoint)
    expect(await isDeployed(_account.address)).to.be.equals(true)
  })

  it('get tspaccount address', async () => {
    const _factory = await new TSPAccountFactory__factory(ethersSigner).deploy(entryPoint)
    const _owner = createAccountOwner()
    const addr = await _factory.getAddress(_owner.address, 0, guardian.address, 100, 10, [AddressZero])
    console.log('address', addr)
    await createTSPAccount(ethers.provider.getSigner(), _owner.address, entryPoint, guardian, _factory)
    console.log('signer address', await ethers.provider.getSigner().getAddress())
    console.log('factory address', _factory.address)
  })

  it('owner should be able to call transfer', async () => {
    const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
    await account.execute(accounts[2], ONE_ETH, '0x')
  })
  it('other account should not be able to call transfer', async () => {
    const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
    await expect(account.connect(ethers.provider.getSigner(1)).execute(accounts[2], ONE_ETH, '0x'))
      .to.be.revertedWith('account: not Owner or EntryPoint')
  })

  it('should pack in js the same as solidity', async () => {
    const op = await fillUserOpDefaults({ sender: accounts[0] })
    const packed = packUserOp(op)
    expect(await testUtil.packUserOp(op)).to.equal(packed)
  })

  describe('#validateUserOp', () => {
    let account: TSPAccount
    let userOp: UserOperation
    let userOpHash: string
    let preBalance: number
    let expectedPay: number

    const actualGasPrice = 1e9

    before(async () => {
      // that's the account of ethersSigner
      const entryPoint = accounts[2];
      ({ proxy: account } = await createTSPAccount(await ethers.getSigner(entryPoint), accountOwner.address, entryPoint, guardian))
      await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('0.2') })
      const callGasLimit = 200000
      const verificationGasLimit = 100000
      const maxFeePerGas = 3e9
      const chainId = await ethers.provider.getNetwork().then(net => net.chainId)

      userOp = signUserOp(fillUserOpDefaults({
        sender: account.address,
        callGasLimit,
        verificationGasLimit,
        maxFeePerGas
      }), accountOwner, entryPoint, chainId)

      userOpHash = await getUserOpHash(userOp, entryPoint, chainId)

      expectedPay = actualGasPrice * (callGasLimit + verificationGasLimit)

      preBalance = await getBalance(account.address)
      const ret = await account.validateUserOp(userOp, userOpHash, expectedPay, { gasPrice: actualGasPrice })
      await ret.wait()
    })

    it('should pay', async () => {
      const postBalance = await getBalance(account.address)
      expect(preBalance - postBalance).to.eql(expectedPay)
    })

    it('should increment nonce', async () => {
      expect(await account.nonce()).to.equal(1)
    })

    it('should reject same TX on nonce error', async () => {
      await expect(account.validateUserOp(userOp, userOpHash, 0)).to.revertedWith('invalid nonce')
    })

    it('should return NO_SIG_VALIDATION on wrong signature', async () => {
      const userOpHash = HashZero
      const deadline = await account.callStatic.validateUserOp({ ...userOp, nonce: 1 }, userOpHash, 0)
      expect(deadline).to.eq(1)
    })

    it('after resetting the owner, the new owner can control the account', async () => {
      const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
      await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
      await account.resetOwner(accounts[1])
      await account.connect((await ethers.getSigners())[1]).execute(accounts[2], ONE_ETH, '0x', { gasLimit: 10000000 })
    })

    it('can not set zero address', async () => {
      const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
      await expect(account.resetOwner(AddressZero)).to.be.revertedWith('new owner is the zero address')
    })

    it('owner should be able set metadata', async () => {
      const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
      await account.setMetadata('abc', '123')
      expect(await account.getMetadata('abc')).to.be.equals('123')
    })

    it('owner should be able delete metadata', async () => {
      const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
      await account.setMetadata('abc', '')
      expect(await account.getMetadata('abc')).to.be.equals('')
    })

    it('other EOA should be able set and get metadata', async () => {
      const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
      await expect(account.connect(ethers.provider.getSigner(2)).setMetadata('abc', '123', { gasLimit: 10000000 })).to.be.revertedWith('only owner')
      await expect(account.connect(ethers.provider.getSigner(2)).getMetadata('abc')).to.be.revertedWith('only owner')
    })

    it('owner should be able change guardian', async () => {
      const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
      await expect(account.connect(ethers.provider.getSigner(3)).changeGuardian(accounts[3])).to.be.revertedWith('only owner')
    })

    it('owner should not be able set zero address', async () => {
      const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
      await expect(account.changeGuardian(AddressZero)).to.be.revertedWith('guardian is the zero address')
    })

    it('If the contract address already exists, return it directly', async () => {
      const _factory = await new TSPAccountFactory__factory(ethers.provider.getSigner()).deploy(entryPoint)
      // const { proxy: _account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint)
      const result1 = await _factory.createAccount(accounts[0], 0, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
      const constract1 = (await result1.wait()).contractAddress
      const result2 = await _factory.createAccount(accounts[0], 0, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
      const constract2 = (await result2.wait()).contractAddress
      expect(constract1).to.be.equals(constract2)
    })

    // it('the account contract cannot be initialized multiple times', async () => {
    //   const { proxy: account } = await createTSPAccount(ethers.provider.getSigner(), accounts[0], entryPoint, guardian)
    //   await expect(account.initialize(AddressZero)).to.be.revertedWith('Initializable: contract is already initialized')
    // })
  })
  context('TSPAccountFactory', () => {
    it('sanity: check deployer', async () => {
      const ownerAddr = createAddress()
      const deployer = await new TSPAccountFactory__factory(ethersSigner).deploy(entryPoint)
      const target = await deployer.callStatic.createAccount(ownerAddr, 1234, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
      expect(await isDeployed(target)).to.eq(false)
      await deployer.createAccount(ownerAddr, 1234, guardian.address, DefaultThreshold, DefaultDelayBlock, [DefaultPlatformGuardian])
      expect(await isDeployed(target)).to.eq(true)
    })
  })
})
