import './aa.init'
import { ethers } from 'hardhat'
import {
  concat,
  EventLog,
  getBytes,
  hexlify, keccak256,
  parseEther,
  resolveAddress,
  Signer,
  toUtf8Bytes,
  ZeroAddress,
  ZeroHash
} from 'ethers'
import {
  EIP4337Fallback__factory,
  EIP4337Manager,
  EIP4337Manager__factory,
  EntryPoint,
  EntryPoint__factory,
  GnosisSafe,
  GnosisSafeAccountFactory,
  GnosisSafeAccountFactory__factory,
  GnosisSafeProxy,
  GnosisSafeProxyFactory__factory,
  GnosisSafe__factory,
  TestCounter,
  TestCounter__factory
} from '../src/types'
import {
  createAddress,
  createAccountOwner,
  deployEntryPoint,
  getBalance,
  isDeployed, defaultAbiCoder
} from './testutils'
import { fillAndSign } from './UserOp'
import { expect } from 'chai'

describe('Gnosis Proxy', function () {
  this.timeout(30000)

  let ethersSigner: Signer
  let safeSingleton: GnosisSafe
  let owner: Signer
  let ownerAddress: string
  let proxy: GnosisSafeProxy
  let manager: EIP4337Manager
  let entryPoint: EntryPoint
  let counter: TestCounter
  let proxySafe: GnosisSafe
  let safe_execTxCallData: string

  let accountFactory: GnosisSafeAccountFactory

  before('before', async function () {
    // EIP4337Manager fails to compile with solc-coverage
    if (process.env.COVERAGE != null) {
      return this.skip()
    }

    const provider = ethers.provider
    ethersSigner = await provider.getSigner()

    // standard safe singleton contract (implementation)
    safeSingleton = await new GnosisSafe__factory(ethersSigner).deploy()
    // standard safe proxy factory
    const proxyFactory = await new GnosisSafeProxyFactory__factory(ethersSigner).deploy()
    entryPoint = await deployEntryPoint()
    manager = await new EIP4337Manager__factory(ethersSigner).deploy(entryPoint.target)
    owner = createAccountOwner()
    ownerAddress = await owner.getAddress()
    counter = await new TestCounter__factory(ethersSigner).deploy()

    accountFactory = await new GnosisSafeAccountFactory__factory(ethersSigner)
      .deploy(proxyFactory.target, safeSingleton.target, manager.target)

    await accountFactory.createAccount(ownerAddress, 0)
    // we use our accountFactory to create and configure the proxy.
    // but the actual deployment is done internally by the gnosis factory
    const ev = await proxyFactory.queryFilter(proxyFactory.filters.ProxyCreation())
    const addr = ev[0].args.proxy

    proxy =
      proxySafe = GnosisSafe__factory.connect(addr, owner)

    await ethersSigner.sendTransaction({
      to: proxy.target,
      value: parseEther('0.1')
    })

    const counter_countCallData = counter.interface.encodeFunctionData('count')
    safe_execTxCallData = manager.interface.encodeFunctionData('executeAndRevert', [counter.target, 0, counter_countCallData, 0])
  })
  let beneficiary: string
  beforeEach(() => {
    beneficiary = createAddress()
  })

  it('#getCurrentEIP4337Manager', async () => {
    // need some manager to query the current manager of a safe
    const tempManager = await new EIP4337Manager__factory(ethersSigner).deploy(ZeroAddress)
    const { manager: curManager } = await tempManager.getCurrentEIP4337Manager(proxySafe.target)
    expect(curManager).to.eq(manager.target)
  })

  it('should validate', async function () {
    await manager.validateEip4337.staticCall(proxySafe.target, manager.target, { gasLimit: 10e6 })
  })

  it('should fail from wrong entrypoint', async function () {
    const op = await fillAndSign({
      sender: proxy.target
    }, owner, entryPoint, 'getNonce')

    const anotherEntryPoint = await new EntryPoint__factory(ethersSigner).deploy()

    await expect(anotherEntryPoint.handleOps([op], beneficiary)).to.revertedWith('account: not from entrypoint')
  })

  it('should fail on invalid userop', async function () {
    let op = await fillAndSign({
      sender: proxy.target,
      nonce: 1234,
      callGasLimit: 1e6,
      callData: safe_execTxCallData
    }, owner, entryPoint, 'getNonce')
    await expect(entryPoint.handleOps([op], beneficiary)).to.revertedWith('AA25 invalid account nonce')

    op = await fillAndSign({
      sender: proxy.target,
      callGasLimit: 1e6,
      callData: safe_execTxCallData
    }, owner, entryPoint, 'getNonce')
    // invalidate the signature
    op.callGasLimit = 1
    await expect(entryPoint.handleOps([op], beneficiary)).to.revertedWith('FailedOp(0, "AA24 signature error")')
  })

  it('should exec', async function () {
    const op = await fillAndSign({
      sender: proxy.target,
      callGasLimit: 1e6,
      callData: safe_execTxCallData
    }, owner, entryPoint, 'getNonce')
    const rcpt = await entryPoint.handleOps([op], beneficiary).then(async r => (await r.wait())!)
    console.log('gasUsed=', rcpt.gasUsed, rcpt.hash)

    const ev = (rcpt.logs as EventLog[]).find(ev => ev.eventName === 'UserOperationEvent')!
    expect(ev.args!.success).to.eq(true)
    expect(await getBalance(beneficiary)).to.eq(ev.args!.actualGasCost)
  })

  it('should revert with reason', async function () {
    const counter_countFailCallData = counter.interface.encodeFunctionData('countFail')
    const safe_execFailTxCallData = manager.interface.encodeFunctionData('executeAndRevert', [counter.target, 0, counter_countFailCallData, 0])

    const op = await fillAndSign({
      sender: proxy.target,
      callGasLimit: 1e6,
      callData: safe_execFailTxCallData
    }, owner, entryPoint, 'getNonce')

    const rcpt = await entryPoint.handleOps([op], beneficiary).then(async r => (await r.wait())!)
    console.log('gasUsed=', rcpt.gasUsed, rcpt.hash)

    // decode the revertReason
    const ev = (rcpt.logs as EventLog[]).find(ev => ev.eventName === 'UserOperationRevertReason')!
    let message: string = ev.args!.revertReason
    if (message.startsWith('0x08c379a0')) {
      // Error(string)
      message = defaultAbiCoder.decode(['string'], '0x' + message.substring(10)).toString()
    }
    expect(message).to.eq('count failed')
  })

  let counterfactualAddress: string
  it('should create account', async function () {
    const initCode = concat([
      await resolveAddress(accountFactory.target),
      accountFactory.interface.encodeFunctionData('createAccount', [ownerAddress, 123])
    ])

    counterfactualAddress = await accountFactory.getFunction('getAddress').staticCall(ownerAddress, 123)
    expect(!await isDeployed(counterfactualAddress))

    await ethersSigner.sendTransaction({
      to: counterfactualAddress,
      value: parseEther('0.1')
    })
    const op = await fillAndSign({
      sender: counterfactualAddress,
      initCode,
      verificationGasLimit: 400000
    }, owner, entryPoint, 'getNonce')

    const rcpt = await entryPoint.handleOps([op], beneficiary).then(async r => (await r.wait())!)
    console.log('gasUsed=', rcpt.gasUsed, rcpt.hash)
    expect(await isDeployed(counterfactualAddress))

    const newCode = await ethers.provider.getCode(counterfactualAddress)
    expect(newCode.length).eq(324)
  })

  it('another op after creation', async function () {
    if (counterfactualAddress == null) this.skip()
    expect(await isDeployed(counterfactualAddress))

    const op = await fillAndSign({
      sender: counterfactualAddress,
      callData: safe_execTxCallData
    }, owner, entryPoint, 'getNonce')

    const rcpt = await entryPoint.handleOps([op], beneficiary).then(async r => (await r.wait())!)
    console.log('gasUsed=', rcpt.gasUsed, rcpt.hash)
  })

  it('should validate ERC1271 signatures', async function () {
    const safe = EIP4337Fallback__factory.connect(await resolveAddress(proxySafe.target), ethersSigner)

    const message = hexlify(toUtf8Bytes('hello erc1271'))
    const dataHash = getBytes(keccak256(message))

    const sig = await owner.signMessage(dataHash)
    expect(await safe.isValidSignature(dataHash, sig)).to.be.eq('0x1626ba7e')

    // make an sig invalid
    const badWallet = ethers.Wallet.createRandom()
    const badSig = await badWallet.signMessage(dataHash)
    expect(await safe.isValidSignature(dataHash, badSig)).to.be.not.eq('0x1626ba7e')
  })

  context('#replaceEIP4337', () => {
    let signature: string
    let newEntryPoint: EntryPoint
    let newFallback: string
    let newManager: EIP4337Manager
    let oldManager: string
    let prev: string

    before(async () => {
      // sig is r{32}s{32}v{1}. for trusting the caller, r.target, v=1
      signature = concat([
        await resolveAddress(ownerAddress),
        ZeroHash,
        '0x01'])
      newEntryPoint = await new EntryPoint__factory(ethersSigner).deploy()

      newManager = await new EIP4337Manager__factory(ethersSigner).deploy(newEntryPoint.target)
      newFallback = await newManager.eip4337Fallback();
      [prev, oldManager] = await manager.getCurrentEIP4337Manager(proxySafe.target)
    })

    it('should reject to replace if wrong old manager', async () => {
      const replaceManagerCallData = manager.interface.encodeFunctionData('replaceEIP4337Manager',
        [prev, newManager.target, oldManager])
      // using call from module, so it return value..

      const proxyFromModule = GnosisSafe__factory.connect(await resolveAddress(entryPoint.target), entryPoint.runner)
      const ret = await proxyFromModule.execTransactionFromModuleReturnData.staticCall(manager.target, 0, replaceManagerCallData, 1)
      const [errorStr] = defaultAbiCoder.decode(['string'], ret.returnData.replace(/0x.{8}/, '0x'))
      expect(errorStr).to.equal('replaceEIP4337Manager: oldManager is not active')
    })

    it('should replace manager', async function () {
      const oldFallback = await manager.eip4337Fallback()
      expect(await proxySafe.isModuleEnabled(entryPoint.target)).to.equal(true)
      expect(await proxySafe.isModuleEnabled(oldFallback)).to.equal(true)

      const mgrAddr = await resolveAddress(manager.target)
      expect(oldManager.toLowerCase()).to.eq(mgrAddr)
      await ethersSigner.sendTransaction({
        to: ownerAddress,
        value: parseEther('33')
      })

      const replaceManagerCallData = manager.interface.encodeFunctionData('replaceEIP4337Manager',
        [prev, oldManager, newManager.target])
      await proxySafe.execTransaction(manager.target, 0, replaceManagerCallData, 1, 1e6, 0, 0, ZeroAddress, ZeroAddress, signature).then(async r => (await r.wait())!)

      // console.log(rcpt.events?.slice(-1)[0].event)

      expect(await proxySafe.isModuleEnabled(newEntryPoint.target)).to.equal(true)
      expect(await proxySafe.isModuleEnabled(newFallback)).to.equal(true)
      expect(await proxySafe.isModuleEnabled(entryPoint.target)).to.equal(false)
      expect(await proxySafe.isModuleEnabled(oldFallback)).to.equal(false)

      const { manager: curManager } = await manager.getCurrentEIP4337Manager(proxySafe.target)
      expect(curManager).to.eq(newManager.target)
    })
  })
})
