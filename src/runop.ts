//run a single op
// "yarn run runop [--network ...]"
import hre, {ethers} from 'hardhat'
import {eventDump, tostr} from "../test/testutils";
import {TestCounter__factory, EntryPoint__factory} from '../typechain-types'
import '../test/aa.init'
import {parseEther} from "ethers/lib/utils";
import {SimpleWalletSigner} from "./ethers/SimpleWalletSigner";

(async () => {
  await hre.run('deploy')
  console.log('net=', hre.network.name)
  const chainId = await hre.getChainId()
  if (!chainId.match(/1337/)) {
    console.log('chainid=', chainId)
    await hre.run('etherscan-verify')
  }
  const [entryPointAddress, walletAddress, testCounterAddress] = await Promise.all([
    hre.deployments.get('EntryPoint').then(d => d.address),
    hre.deployments.get('SimpleWallet').then(d => d.address),
    hre.deployments.get('TestCounter').then(d => d.address),
  ])

  let provider = ethers.provider;
  const ethersSigner = provider.getSigner()

  if (chainId.match(/1337/)) {
    SimpleWalletSigner.eventsPollingInterval = 100
  }

  const url = process.env.AA_URL

  const aasigner = new SimpleWalletSigner(ethersSigner, {
    entryPointAddress,
    sendUserOpUrl: url, // O?? debugRpcUrl(entryPointAddress, ethersSigner)
    debug_handleOpSigner: url == null ? ethersSigner : undefined  //use debug signer only if no URL
  })
  //use an externally-created wallet (which supports our owner
  // await aasigner.connectWalletAddress(walletAddress)
  const myAddress = await aasigner.getAddress()
  if (await provider.getBalance(myAddress) < parseEther('0.01')) {
    console.log('prefund wallet')
    await ethersSigner.sendTransaction({to: myAddress, value: parseEther('0.01')})
  }

  //usually, a wallet will deposit for itself (that is, get created using eth, run "addDeposit" for itself
  // and from there on will use deposit
  // for testing,
  const entryPoint = EntryPoint__factory.connect(entryPointAddress, ethersSigner)
  const info = await entryPoint.getStakeInfo(myAddress)
  const currentStake = info.stake.toString()
  console.log('current stake=', currentStake)

  if (info.stake.lte(parseEther('0.001'))) {
    console.log('depositing for wallet')
    await entryPoint.addDepositTo(myAddress, {value: parseEther('0.001')})
  }

  const testCounter = TestCounter__factory.connect(testCounterAddress, aasigner)

  const prebalance = await provider.getBalance(myAddress)
  let ret
  let rcpt
  console.log('current counter=', await testCounter.counters(myAddress), 'balance=', prebalance, 'stake=', currentStake)
  ret = await testCounter.count()
  console.log('waiting for mine, tmp.hash=', ret.hash)
  rcpt = await ret.wait()
  console.log('rcpt', rcpt.transactionHash, `https://dashboard.tenderly.co/tx/kovan/${rcpt.transactionHash}/gas-usage`)
  console.log('events=', eventDump(await testCounter.queryFilter('*' as any, rcpt.blockNumber)))
  let gasPaid = prebalance.sub(await provider.getBalance(myAddress))
  console.log('counter after=', await testCounter.counters(myAddress).then(tostr), 'paid=', gasPaid.toNumber() / 1e9, 'gasUsed=', rcpt.gasUsed.toNumber())
  let logs
  logs = await entryPoint.queryFilter('*' as any, rcpt.blockNumber)
  console.log('UserOperationEvent success=', (logs[0].args as any).success)
  // console.log(logs.map((e: any) => ({ev: e.event, ...objdump(e.args!)})))


})().then(() => process.exit())
