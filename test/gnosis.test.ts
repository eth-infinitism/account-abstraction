import './aa.init'
import {ethers} from "hardhat";
import {Signer} from "ethers";
import {
  EIP4337Module, EIP4337Module__factory,
  EntryPoint, GnosisSafe, GnosisSafe__factory, SafeProxy4337, SafeProxy4337__factory, TestCounter, TestCounter__factory
} from "../typechain";
import {AddressZero, createAddress, createWalletOwner, deployEntryPoint, getBalance} from "./testutils";
import {fillAndSign} from "./UserOp";
import {parseEther} from "ethers/lib/utils";
import {expect} from "chai";

describe('Gnosis Proxy', () => {
  let ethersSigner: Signer
  let safeSingleton: GnosisSafe
  let owner: Signer
  let ownerAddress: string
  let proxy: SafeProxy4337
  let module: EIP4337Module
  let entryPoint: EntryPoint
  let counter: TestCounter
  let proxySafe: GnosisSafe
  let safe_execTxCallData: string
  before("before", async () => {
    let provider = ethers.provider;
    ethersSigner = provider.getSigner()
    safeSingleton = await new GnosisSafe__factory(ethersSigner).deploy()
    entryPoint = await deployEntryPoint(1, 1)
    module = await new EIP4337Module__factory(ethersSigner).deploy(entryPoint.address)
    owner = createWalletOwner()
    ownerAddress = await owner.getAddress()
    counter = await new TestCounter__factory(ethersSigner).deploy()

    proxy = await new SafeProxy4337__factory(ethersSigner).deploy(safeSingleton.address, module.address, ownerAddress)

    proxySafe = GnosisSafe__factory.connect(proxy.address, provider)

    const modules = await proxySafe.getModulesPaginated(AddressZero.replace(/0$/, '1'), 10)
    console.log('modules=', modules.array)
    ethersSigner.sendTransaction({to: proxy.address, value: parseEther('0.1')})

    const counter_countCallData = counter.interface.encodeFunctionData('count')
    safe_execTxCallData = safeSingleton.interface.encodeFunctionData('execTransactionFromModule', [counter.address, 0, counter_countCallData, 0])
  })
  let beneficiary: string
  beforeEach(() => {
    beneficiary = createAddress()
  })

  it('should validate', async function () {
    await module.callStatic.validateEip4337(proxySafe.address, module.address, {gasLimit: 10e6});
  });

  it('should fail from wrong entrypoint', async function () {
    const op = await fillAndSign({
      sender: proxy.address,
    }, owner, entryPoint)

    const anotherEntryPoint = await deployEntryPoint(2, 2)

    await expect(anotherEntryPoint.handleOps([op], beneficiary)).to.revertedWith('wallet: not from entrypoint')
  });

  it('should fail on invalid userop', async function () {
    const op = await fillAndSign({
      sender: proxy.address,
      nonce: 1234,
      callGas: 1e6,
      callData: safe_execTxCallData
    }, owner, entryPoint)
    await expect(entryPoint.handleOps([op], beneficiary)).to.revertedWith('wallet: invalid nonce')

    op.callGas = 1
    await expect(entryPoint.handleOps([op], beneficiary)).to.revertedWith('wallet: wrong signature')
  });

  it('should exec', async function () {
    const op = await fillAndSign({
      sender: proxy.address,
      callGas: 1e6,
      callData: safe_execTxCallData
    }, owner, entryPoint)
    const rcpt = await entryPoint.handleOps([op], beneficiary).then(r => r.wait())
    console.log('gasUsed=', rcpt.gasUsed)

    const ev = rcpt.events!.find(ev => ev.event == 'UserOperationEvent')!
    expect(ev.args!.success).to.eq(true)
    expect(await getBalance(beneficiary)).to.eq(ev.args!.actualGasCost)
  });

  it('should create wallet', async function () {
    const initCode = await new SafeProxy4337__factory(ethersSigner).getDeployTransaction(safeSingleton.address, module.address, ownerAddress).data!

    const salt = Date.now()
    const counterfactualAddress = await entryPoint.getSenderAddress(initCode, salt)
    const code = await ethers.provider.getCode(counterfactualAddress)
    expect(code.length).to.eq(2)

    await ethersSigner.sendTransaction({to: counterfactualAddress, value: parseEther('0.1')})
    const op = await fillAndSign({
      initCode,
      nonce: salt,
      verificationGas: 400000
    }, owner, entryPoint)

    const ret = await entryPoint.handleOps([op], beneficiary).then(r => r.wait())
    console.log('gasUsed=', ret.gasUsed)
    const newCode = await ethers.provider.getCode(counterfactualAddress)
    expect(newCode.length).eq(248)
  });
})