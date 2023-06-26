// run a single op
// "yarn run runop [--network ...]"

import hre, { ethers } from 'hardhat'
import { objdump } from '../test/testutils'
import { AASigner, localUserOpSender, rpcUserOpSender } from './AASigner'
import { TestCounter__factory, EntryPoint__factory } from './types'
import '../test/aa.init'
import { formatUnits, JsonRpcProvider, parseEther, TransactionReceipt } from 'ethers';

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
  console.log('net=', hre.network.name)
  const aa_url = process.env.AA_URL

  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  if (aa_url == null && !process.env.FORCE_DEPLOY) {
    await hre.run('deploy')
    const chainId = await hre.getChainId()
    if (chainId.match(/1337/) == null) {
      console.log('chainid=', chainId)
      await hre.run('etherscan-verify')
    }
  }
  const [entryPointAddress, testCounterAddress, accountFactoryAddress] = await Promise.all([
    hre.deployments.get('EntryPoint').then(d => d.address),
    hre.deployments.get('TestCounter').then(d => d.address),
    hre.deployments.get('SimpleAccountFactory').then(d => d.address)
  ])

  console.log('entryPointAddress:', entryPointAddress, 'testCounterAddress:', testCounterAddress)
  const provider = ethers.provider
  const ethersSigner = await provider.getSigner(0)
  const prefundAccountAddress = await ethersSigner.getAddress()
  const prefundAccountBalance = await provider.getBalance(prefundAccountAddress)
  console.log('using prefund account address', prefundAccountAddress, 'with balance', prefundAccountBalance.toString())

  let sendUserOp

  if (aa_url != null) {
    const newprovider = new JsonRpcProvider(aa_url)
    sendUserOp = rpcUserOpSender(newprovider, entryPointAddress)
    const supportedEntryPoints: string[] = await newprovider.send('eth_supportedEntryPoints', []).then(ret => ret.map(ethers.getAddress))
    console.log('node supported EntryPoints=', supportedEntryPoints)
    if (!supportedEntryPoints.includes(entryPointAddress)) {
      console.error('ERROR: node', aa_url, 'does not support our EntryPoint')
    }
  } else {
    sendUserOp = localUserOpSender(entryPointAddress, ethersSigner)
  }

  // index is unique for an account (so same owner can have multiple accounts, with different index
  const index = parseInt(process.env.AA_INDEX ?? '0')
  console.log('using account index (AA_INDEX)', index)
  const aasigner = new AASigner(ethersSigner, entryPointAddress, sendUserOp, accountFactoryAddress, index)
  // connect to pre-deployed account
  // await aasigner.connectAccountAddress(accountAddress)
  const myAddress = await aasigner.getAddress()
  if (await provider.getBalance(myAddress) < parseEther('0.01')) {
    console.log('prefund account')
    await ethersSigner.sendTransaction({ to: myAddress, value: parseEther('0.01') })
  }

  // usually, an account will deposit for itself (that is, get created using eth, run "addDeposit" for itself
  // and from there on will use deposit
  // for testing,
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, ethersSigner)
  console.log('account address=', myAddress)
  let preDeposit = await entryPoint.balanceOf(myAddress)
  console.log('current deposit=', preDeposit, 'current balance', await provider.getBalance(myAddress))

  if (preDeposit <= parseEther('0.005')) {
    console.log('depositing for account')
    await entryPoint.depositTo(myAddress, { value: parseEther('0.01') })
    preDeposit = await entryPoint.balanceOf(myAddress)
  }

  const testCounter = TestCounter__factory.connect(testCounterAddress, aasigner)

  const prebalance = await provider.getBalance(myAddress)
  console.log('balance=', formatUnits(prebalance, 'gwei'), 'deposit=', formatUnits(preDeposit, 'gwei'))
  console.log('estimate direct call', { gasUsed: await testCounter.connect(ethersSigner).justemit.estimateGas() })
  const ret = await testCounter.justemit()
  console.log('waiting for mine, hash (reqId)=', ret.hash)
  const rcpt = await ret.wait()
  if (rcpt == null) {
    throw new Error('receipt not found')
  }
  const netname = await provider.getNetwork().then(net => net.name)
  if (netname !== 'unknown') {
    console.log('rcpt', rcpt?.hash, `https://dashboard.tenderly.co/tx/${netname}/${rcpt?.hash}/gas-usage`)
  }
  const gasPaid = prebalance - await provider.getBalance(myAddress)
  const depositPaid = preDeposit - await entryPoint.balanceOf(myAddress)

  console.log('paid (from balance)=', formatUnits(gasPaid, 'gwei'), 'paid (from deposit)', formatUnits(depositPaid, 'gwei'), 'gasUsed=', rcpt.gasUsed)
  const logs = await entryPoint.queryFilter('*' as any, rcpt.blockNumber)
  console.log(logs.map((e: any) => ({ ev: e.event, ...objdump(e.args!) })))
  console.log('1st run gas used:', await evInfo(rcpt))

  const ret1 = await testCounter.justemit()
  const rcpt2 = await ret1.wait()
  if (rcpt2 == null) {
    throw new Error('2nd receipt not found')
  }
  console.log('2nd run:', await evInfo(rcpt2))

  async function evInfo (rcpt: TransactionReceipt): Promise<any> {
    // TODO: checking only latest block...
    const block = rcpt.blockNumber
    const ev = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), block)
    // if (ev.length === 0) return {}
    return ev.map(event => {
      const { nonce, actualGasUsed } = event.args
      const gasUsed = rcpt.gasUsed
      return { nonce: nonce, gasPaid, gasUsed: gasUsed, diff: gasUsed - actualGasUsed }
    })
  }
})()
