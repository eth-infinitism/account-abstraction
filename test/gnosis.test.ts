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
    entryPoint.depositTo(proxy.address, {value: parseEther('0.1')})

  })
  it('should validate', async function () {
    await module.callStatic.validateEip4337(proxySafe.address, module.address, {gasLimit:10e6});
  });

  it('should exec', async function () {
    const counter_count = counter.interface.encodeFunctionData('count')
    const safe_execTx = safeSingleton.interface.encodeFunctionData('execTransactionFromModule', [counter.address, 0, counter_count, 0])
    const op = await fillAndSign({
      sender: proxy.address,
      callGas: 1e6,
      callData: safe_execTx
    }, owner, entryPoint)
    const beneficiary = createAddress()
    const ret = await entryPoint.handleOps([op], beneficiary)
    let rcpt = await ret.wait();
    const ev = rcpt.events!.find(ev => ev.event == 'UserOperationEvent')!
    expect(ev.args!.success).to.eq(true)
  });
})