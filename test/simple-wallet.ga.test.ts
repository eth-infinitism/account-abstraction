import { Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  ERC1967Proxy__factory,
  SimpleAccount,
  SimpleAccountFactory__factory,
  SimpleAccount__factory,
  TestUtil,
  TestUtil__factory
} from '../typechain'
import {
  createAccount,
  createAddress,
  createAccountOwner,
  deployEntryPoint,
  getBalance,
  isDeployed,
  ONE_ETH,
  HashZero,
  createAccountGA
} from './testutils'
import { fillUserOpDefaults, getUserOpHash, packUserOp, signUserOp } from './UserOp'
import { parseEther } from 'ethers/lib/utils'
import { UserOperation } from './UserOperation'
import { MerkleTree } from 'merkletreejs'
import { bufferToHex } from 'ethereumjs-util'

describe('SimpleAccountGA', function () {
  let entryPoint: string
  let accounts: string[]
  let testUtil: TestUtil
  let accountOwner: Wallet
  const ethersSigner = ethers.provider.getSigner()

  before(async function () {
    entryPoint = await deployEntryPoint().then(e => e.address)
    accounts = await ethers.provider.listAccounts()
    // ignore in geth.. this is just a sanity test. should be refactored to use a single-account mode..
    if (accounts.length < 2) this.skip()
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    accountOwner = createAccountOwner()
  })

  it('it should revert when execute without any calldata ', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
    await expect(account.execute(accounts[2], ONE_ETH, '0x')).to.be.revertedWith('Calldata too short')
  })

  it('it should revert when execute with calldata not including execute2FA ', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
    const wrappedExecute = await account.populateTransaction.execute(accounts[2], ONE_ETH, '0x')
    await expect(account.execute(accounts[2], ONE_ETH, wrappedExecute.data!)).to.be.revertedWith('Calldata must be for execute2FA')
  })

  it('it should allow owner to execute2FA when no 2FA setup ', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
    const bytes32Empty = ethers.utils.formatBytes32String("");
    const wrappedExecute = await account.populateTransaction.execute2FA(bytes32Empty, [], accounts[2], ONE_ETH, '0x')
    await account.execute(accounts[2], ONE_ETH, wrappedExecute.data!)
  })

  function getTimestamp(addedSeconds: number) {
    const now = new Date()
    now.setSeconds(now.getSeconds() + addedSeconds);
    return Math.floor(now.getTime() / 1000)
  }

  it('it should revert when calling execute2FA 2FA is setup but no 2FA is provided ', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)

    const dummyMerkleRoot = ethers.utils.keccak256(ethers.utils.randomBytes(32))
    const futureTimestamp = getTimestamp(1)

    await account.updateRoot(dummyMerkleRoot, futureTimestamp)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
    const bytes32Empty = ethers.utils.formatBytes32String('')
    await expect(account.execute2FA(bytes32Empty, [], accounts[2], ONE_ETH, '0x')).to.be.revertedWith('invalid leaf validity')
  })

  it('it should revert when calling execute2FA 2FA is setup but invalid proof is provided', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)

    const dummyMerkleRoot = ethers.utils.keccak256(ethers.utils.randomBytes(32))
    const futureTimestamp = getTimestamp(10)
    console.log("futureTimestamp", futureTimestamp);

    await account.updateRoot(dummyMerkleRoot, futureTimestamp)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })

    const combined = pairToBytesString({ timestamp: futureTimestamp, code: 123 })

    await expect(account.execute2FA(combined, [], accounts[2], ONE_ETH, '0x')).to.be.revertedWith('invalid merkle tree')
  })

  const hashFunction = (el: Buffer) => {
    return Buffer.from(ethers.utils.keccak256(el).slice(2), 'hex');
};

  interface Pair {
    code: number,
    timestamp: number
  }

  function pairToBytesString(pair: Pair) {
    const timestampBN = ethers.BigNumber.from(pair.timestamp)
    const codeBN = ethers.BigNumber.from(pair.code)

    const bytes1 = ethers.utils.zeroPad(timestampBN.toHexString(), 16)
    const bytes2 = ethers.utils.zeroPad(codeBN.toHexString(), 16)
    const combined = ethers.utils.hexlify(ethers.utils.concat([bytes1, bytes2]))
    return combined
  }

  function generateMerkleTreeRoot(pairs: Pair[]) {
    const tree = getMerkletree(pairs)
    const root = bufferToHex(tree.getRoot())
    return root
  }

  function getMerkleTreeProof(pairs: Pair[], leaf: Pair) {
    const tree = getMerkletree(pairs)
    const leafToSearch = pairToBytesString(leaf)

    // const proof = tree.getProof(leafToSearch)
    const proof = tree.getProof(leafToSearch).map(p => '0x' + p.data.toString('hex'))
    return proof
  }

  function getMerkletree(pairs: Pair[]) {
    const data = pairs.map((p) => pairToBytesString(p))
    const tree = new MerkleTree(data, hashFunction)
    return tree
  }

  it('it should succeed execute2fa when valid proof is provided', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)

    const futureTimestamp = getTimestamp(10)
    console.log("futureTimestamp", futureTimestamp)

    const leafForProof = { code: 1234, timestamp: futureTimestamp }
    const secondLeaf = { code: 4567, timestamp: futureTimestamp + 300 * 1000 }

    const data: Pair[] = [leafForProof, secondLeaf]
    const root = generateMerkleTreeRoot(data)
    const proof = getMerkleTreeProof(data, leafForProof)

    await account.updateRoot(root, futureTimestamp)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })

    const combined = pairToBytesString(leafForProof)
    await account.execute2FA(combined, proof, accounts[2], ONE_ETH, '0x')
  })

  it('it should succeed execute -> execute2fa when valid proof is provided', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)
    console.log("account", account.address)

    const futureTimestamp = getTimestamp(10)
    console.log("futureTimestamp", futureTimestamp)

    const leafForProof = { code: 1234, timestamp: futureTimestamp }
    const secondLeaf = { code: 4567, timestamp: futureTimestamp + 300 * 1000 }

    const data: Pair[] = [leafForProof, secondLeaf]
    const root = generateMerkleTreeRoot(data)
    const proof = getMerkleTreeProof(data, leafForProof)

    await account.updateRoot(root, futureTimestamp)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })

    const combined = pairToBytesString(leafForProof)
    // await account.execute2FA(combined, proof, accounts[2], ONE_ETH, '0x')

    console.log("orig balance", (await ethers.provider.getBalance(accounts[2])).toString())
    const wrappedExecute = await account.populateTransaction.execute2FA(combined, proof, accounts[2], ONE_ETH, '0x')
    console.log("wrappedExecute.data", wrappedExecute.data)
    await account.execute(account.address, 0, wrappedExecute.data!)
    console.log("after balance", (await ethers.provider.getBalance(accounts[2])).toString())
  })

  it('it should revert when 2FA is setup but no 2FA is provided ', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)

    const dummyMerkleRoot = ethers.utils.keccak256(ethers.utils.randomBytes(32))
    const futureTimestamp = getTimestamp(1)

    await account.updateRoot(dummyMerkleRoot, futureTimestamp)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
    const bytes32Empty = ethers.utils.formatBytes32String('')
    const wrappedExecute = await account.populateTransaction.execute2FA(bytes32Empty, [], accounts[2], ONE_ETH, '0x')
    await account.execute(account.address, ONE_ETH, wrappedExecute.data!)
  })

  it('owner should be able to call transfer', async () => {
    const { proxy: account } = await createAccountGA(ethers.provider.getSigner(), accounts[0], entryPoint)
    await ethersSigner.sendTransaction({ from: accounts[0], to: account.address, value: parseEther('2') })
    await account.execute(accounts[2], ONE_ETH, '0x')
  })


  it('other account should not be able to call transfer', async () => {
    const { proxy: account } = await createAccount(ethers.provider.getSigner(), accounts[0], entryPoint)
    await expect(account.connect(ethers.provider.getSigner(1)).execute(accounts[2], ONE_ETH, '0x'))
      .to.be.revertedWith('account: not Owner or EntryPoint')
  })

  it('should pack in js the same as solidity', async () => {
    const op = await fillUserOpDefaults({ sender: accounts[0] })
    const packed = packUserOp(op)
    expect(await testUtil.packUserOp(op)).to.equal(packed)
  })

  describe('#validateUserOp', () => {
    let account: SimpleAccount
    let userOp: UserOperation
    let userOpHash: string
    let preBalance: number
    let expectedPay: number

    const actualGasPrice = 1e9
    // for testing directly validateUserOp, we initialize the account with EOA as entryPoint.
    let entryPointEoa: string

    before(async () => {
      entryPointEoa = accounts[2]
      const epAsSigner = await ethers.getSigner(entryPointEoa)

      // cant use "SimpleAccountFactory", since it attempts to increment nonce first
      const implementation = await new SimpleAccount__factory(ethersSigner).deploy(entryPointEoa)
      const proxy = await new ERC1967Proxy__factory(ethersSigner).deploy(implementation.address, '0x')
      account = SimpleAccount__factory.connect(proxy.address, epAsSigner)

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
      }), accountOwner, entryPointEoa, chainId)

      userOpHash = await getUserOpHash(userOp, entryPointEoa, chainId)

      expectedPay = actualGasPrice * (callGasLimit + verificationGasLimit)

      preBalance = await getBalance(account.address)
      const ret = await account.validateUserOp(userOp, userOpHash, expectedPay, { gasPrice: actualGasPrice })
      await ret.wait()
    })

    it('should pay', async () => {
      const postBalance = await getBalance(account.address)
      expect(preBalance - postBalance).to.eql(expectedPay)
    })

    it('should return NO_SIG_VALIDATION on wrong signature', async () => {
      const userOpHash = HashZero
      const deadline = await account.callStatic.validateUserOp({ ...userOp, nonce: 1 }, userOpHash, 0)
      expect(deadline).to.eq(1)
    })
  })

  context('SimpleAccountFactory', () => {
    it('sanity: check deployer', async () => {
      const ownerAddr = createAddress()
      const deployer = await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint)
      const target = await deployer.callStatic.createAccount(ownerAddr, 1234)
      expect(await isDeployed(target)).to.eq(false)
      await deployer.createAccount(ownerAddr, 1234)
      expect(await isDeployed(target)).to.eq(true)
    })
  })
})
