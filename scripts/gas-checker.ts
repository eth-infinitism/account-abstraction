// calculate gas usage of different bundle sizes
import '../test/aa.init'
import {formatEther, formatUnits, parseEther} from "ethers/lib/utils";
import {AddressZero, checkForGeth, createAddress, createWalletOwner, deployEntryPoint} from "../test/testutils";
import {EntryPoint, EntryPoint__factory, SimpleWallet__factory} from "../typechain";
import {BigNumberish, Wallet} from "ethers";
import hre from 'hardhat'
import {fillAndSign, packUserOp} from "../test/UserOp";
import {SimpleWalletInterface} from "../typechain/SimpleWallet";
import 'colors'
import {UserOperation} from "../test/UserOperation";

const ethers = hre.ethers
const provider = hre.ethers.provider
let ethersSigner = provider.getSigner()
let lastGasUsed: number

const minDepositOrBalance = parseEther('0.1')

const getBalance = hre.ethers.provider.getBalance

function range(n: number): number[] {
  return Array(n).fill(0).map((val, index) => index)
}

// task("gascalc", "calculate gas costs")
//   // .addParam<string>("entrypoint", "entryPoint address, or \"test\" to deploy")
//   // .addFlag('withGsn', 'Spin up GSN contracts and relayer when starting node')
//   .setAction(async (args, hre, runSuper) => {
//     await gascalc(hre, args.entrypoint)
//   })

let walletInterface: SimpleWalletInterface
let wallets: { wallet: string, walletOwner: Wallet }[] = []
let entryPoint: EntryPoint
let walletOwner: Wallet

enum PaymentMethod { WalletBalance, WalletDeposit, Paymaster}

interface TestInfo {
  diffLastGas: boolean;
  payment: PaymentMethod,
  count: number
  dest: string
  destValue: BigNumberish
  destCallData: string
  beneficiary: string
  gasPrice: number
}

const DefaultInfo: Partial<TestInfo> = {
  payment: PaymentMethod.WalletDeposit,
  dest: AddressZero,
  destValue: parseEther('0'),
  destCallData: '0x',
  gasPrice: 10e9
}

async function init(entryPointAddress: string = 'test') {
  // await checkForGeth()

  console.log('signer=', await ethersSigner.getAddress())
  DefaultInfo.beneficiary = createAddress()

  if ((await getBalance(ethersSigner.getAddress())).gt(parseEther('100'))) {
    console.log('DONT use geth miner.. use account 2 instead')
    await checkForGeth()
    ethersSigner = ethers.provider.getSigner(2)
  }

  if (entryPointAddress == 'test') {
    console.debug('== deploy entryPoint'.yellow)
    entryPoint = await deployEntryPoint(1, 1, provider)
    console.debug('== deployed Entrypoint'.green)
  } else {
    entryPoint = EntryPoint__factory.connect(entryPointAddress, ethersSigner)
  }
  walletOwner = createWalletOwner()
  const simpleWalletFactory = new SimpleWallet__factory(ethersSigner)

  walletInterface = SimpleWallet__factory.createInterface()

  return

  //create wallets
  //todo: why create2 doesn't deploy?!?!
  await Promise.all(range(1).map(async () => {
    console.log('== deploy wallet'.yellow)
    const w = await simpleWalletFactory.deploy(entryPoint.address, walletOwner.address, {
      // gasPrice: 20e9
    })
    console.log('== submitted'.yellow, w.address, w.deployTransaction.hash)
    await w.deployed()
    console.log('== wallet deployed'.green, w.address)
    wallets.push({wallet: w.address, walletOwner})
  }))
}

async function isDeployed(addr: string) {
  const code = await ethers.provider.getCode(addr)
  return code.length > 2
}

//must be FALSE for automining (hardhat), otherwise "true"
let useAutoNonce = false

async function createWallets(count: number) {
  const constructorCode = new SimpleWallet__factory().getDeployTransaction(entryPoint.address, walletOwner.address).data!

  let nonce = await provider.getTransactionCount(ethersSigner.getAddress())

  function autoNonce() {
    if (useAutoNonce) {
      return nonce++
    } else {
      return undefined
    }
  }

  const ops1 = await Promise.all(range(count).map(async index => {
    const addr = await entryPoint.getSenderAddress(constructorCode, index)
    wallets.push({wallet: addr, walletOwner})
    if (await isDeployed(addr)) {
      console.log('== wallet', addr, 'already deployed'.yellow)
      return
    }

    return fillAndSign({
      sender: addr,
      initCode: constructorCode,
      nonce: index
    }, walletOwner, entryPoint)
  }))

  const userOps = ops1.filter(x => x != undefined) as UserOperation[]
  //deposit balance for deployment (todo: excelent place to use a paymaster...)
  for (let op of userOps) {
    let addr = op.sender;
    let walletBalance = await entryPoint.balanceOf(addr);
    if (walletBalance.lte(minDepositOrBalance)) {
      console.debug('== wallet', addr, 'depositing for create'.yellow)
      await entryPoint.depositTo(addr, { value: minDepositOrBalance.mul(5)})
    }
  }

  if (userOps.length > 0) {
    const ret = await entryPoint.handleOps(userOps, DefaultInfo.beneficiary!)
    const rcpt = await ret.wait()
    console.log('deployment'.green, 'of', userOps.length, 'wallets, gas cost=', rcpt.gasUsed.toNumber())
  } else {
    console.log('all', count, 'wallets already deployed'.yellow)
  }
}

async function runTest(params: Partial<TestInfo>) {
  const info = {...params, ...DefaultInfo} as TestInfo
  console.log('== running test count=', info.count)
  //we send transaction sin parallel: must manage nonce manually.
  let nonce = await provider.getTransactionCount(ethersSigner.getAddress())
  const userOps = await Promise.all(range(info.count)
    .map(index => wallets[index])
    .map(async ({wallet, walletOwner}) => {
      switch (info.payment) {
        case PaymentMethod.WalletDeposit:
          if ((await entryPoint.balanceOf(wallet)).lte(minDepositOrBalance)) {
            console.log('== deposit to wallet', wallet)
            await entryPoint.depositTo(wallet, {nonce: nonce++, value: minDepositOrBalance.mul(5)})
          }
          break
        case PaymentMethod.WalletBalance:
          if ((await getBalance(wallet)).lte(minDepositOrBalance)) {
            console.log('== send balance to wallet', wallet)
            await ethersSigner.sendTransaction({nonce: nonce++, to: wallet, value: minDepositOrBalance.mul(5)})
          }
          break
        case PaymentMethod.Paymaster:
          throw new Error('=== paymaster mode not yet ready')
      }
      const walletExecFromEntryPoint = walletInterface.encodeFunctionData('execFromEntryPoint',
        [info.dest, info.destValue, info.destCallData])
      const walletEst = await ethers.provider.estimateGas({
        from: entryPoint.address,
        to: wallet,
        data: walletExecFromEntryPoint
      })
      // console.log('== wallet est=', walletEst.toString())
      const op = await fillAndSign({
        sender: wallet,
        callData: walletExecFromEntryPoint,
        maxPriorityFeePerGas: info.gasPrice,
        maxFeePerGas: info.gasPrice,
        callGas: walletEst,
        verificationGas: 100000,
        preVerificationGas: 1
      }, walletOwner, entryPoint)
      // const packed = packUserOp(op, false)
      // console.log('== packed cost=', callDataCost(packed), packed)
      return op
    }))

  const ret = await entryPoint.handleOps(userOps, info.beneficiary)
  const rcpt = await ret.wait()
  let gasUsed = rcpt.gasUsed.toNumber()
  console.log('count', info.count, 'gasUsed', gasUsed)
  if (info.diffLastGas) {
    console.log('\tgas diff=', gasUsed - lastGasUsed)
  }
  lastGasUsed = gasUsed
  console.debug( 'handleOps tx.hash=', rcpt.transactionHash.yellow)
  return rcpt
}

async function runGasCalcs() {
  // await init('0x602aB3881Ff3Fa8dA60a8F44Cf633e91bA1FdB69')
  await init()
  await createWallets(20)

  await runTest({count: 1, diffLastGas: false})
  await runTest({count: 2, diffLastGas: true})
  await runTest({count: 4, diffLastGas: false})
  await runTest({count: 5, diffLastGas: true})
  await runTest({count: 19, diffLastGas: false})
  await runTest({count: 20, diffLastGas: true})
}

runGasCalcs()
  .then(() => process.exit(0))
  .catch(err => {
    console.log(err)
    process.exit(1)
  })
