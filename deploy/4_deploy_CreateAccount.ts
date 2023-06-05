import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'
import { ethers } from 'hardhat'
import { fillAndSign } from '../test/UserOp'
import { AddressZero } from '../test/testutils'

const deploySimpleAccountFactory: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const provider = ethers.provider

  const safAddress = await hre.deployments.get('SimpleAccountFactory')
  const paymaster = await hre.deployments.get('TokenPaymaster')
  const entrypoint = await hre.deployments.get('EntryPoint')



  const money = await provider.getSigner("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")


  const entryPointAccount = await ethers.getContractAt('EntryPoint', entrypoint.address)
  console.log("before deposit");
  const tx = await entryPointAccount.connect(money).depositTo(paymaster.address, {value: "1000000000000000000"})
  console.log("after deposit");
  await tx.wait()

  console.log("paymaster deposit", (await entryPointAccount.getDepositInfo(paymaster.address)).deposit.toString())

  const accountOwner = "0x7E71FB21D0B30F5669f8F387D4A1114294F8E418"
  const saf = await ethers.getContractAt('SimpleAccountFactory', safAddress.address)
  await saf.createAccount(accountOwner, 0)
  const accountAddress = await saf.getAddress(accountOwner, 0)
  await money.sendTransaction({to: accountOwner, value: "1000000000000000000"})

  console.log("==Created account==", accountAddress)


  const account = await ethers.getContractAt('SimpleAccount', accountAddress)
  const entryPointFullContract = await ethers.getContractAt('EntryPoint', entrypoint.address)
  const paymasterFullContract = await ethers.getContractAt('TokenPaymaster', paymaster.address)

  // const updateEntryPoint = await account.populateTransaction.withdrawDepositTo(AddressZero, 0).then(tx => tx.data!)
  // const updateEntryPoint = await account.populateTransaction.sendViaCall("0x14dc79964da2c08b23698b3d3cc7ca32193d9955").then(tx => tx.data!)
  const accountOwnerSigner = await provider.getSigner(accountOwner)
  console.log("before populate transaction");
  // const updateEntryPoint = await accountOwnerSigner.populateTransaction({from: accountOwner, to: "0x14dc79964da2c08b23698b3d3cc7ca32193d9955", value: "100"})
  // const updateEntryPoint = await account.populateTransaction.sendViaCall("0x14dc79964da2c08b23698b3d3cc7ca32193d9955")
  // console.log("aaa", updateEntryPoint);
  const calldata = await account.populateTransaction.execute("0x14dc79964da2c08b23698b3d3cc7ca32193d9955", "100", []).then(tx => tx.data!)
  console.log("after populate transaction");

  const tx2 = await entryPointAccount.connect(money).depositTo(account.address, {value: "1000000000000000000"})
  await tx2.wait()

  console.log("entryPoint deposit", (await account.getDeposit()).toString())

  const txTransferToAccount = await money.sendTransaction( {to: account.address, value: "1000000000000000000"})
  const txToSendViaCall = await account.sendViaCall("0x14dc79964da2c08b23698b3d3cc7ca32193d9955")
  const txSendViaCallReceipt = await txToSendViaCall.wait()

  // const withdraw = await account.withdrawDepositTo("0xf5376F4d1A1e0D2bEbE0302395C41c581e7620C4", "11")
  // const receipt = await withdraw.wait()
  console.log("txSendViaCallReceipt logs", txSendViaCallReceipt.logs)

  console.log("after withdraw")


  console.log("entryPointFullContract", entryPointFullContract.address);


  console.log("mintTokens")
  const paymasterOwner = await provider.getSigner("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
  console.log("assumed pmOwner", await paymasterOwner.getAddress());
  console.log("real pmOwner", await paymasterFullContract.owner())
  const txxx = await paymasterFullContract.connect(paymasterOwner).mintTokens(account.address, "1000000000000000000")
  console.log("after mintTokens")
  await txxx.wait()


  const uo = await fillAndSign({
    sender: account.address,
    paymasterAndData: paymaster.address,
    callData: calldata
  }, accountOwnerSigner, entryPointFullContract)

  const uo2 = {
    sender: uo.sender,
    nonce: uo.nonce.toString(),
    initCode: uo.initCode,
    callData: uo.callData,
    callGasLimit: uo.callGasLimit.toString(),
    verificationGasLimit: uo.verificationGasLimit,
    preVerificationGas: uo.preVerificationGas,
    maxFeePerGas: uo.maxFeePerGas.toString(),
    maxPriorityFeePerGas: uo.maxPriorityFeePerGas,
    paymasterAndData: uo.paymasterAndData,
    signature: uo.signature
  }

  console.log("uo", JSON.stringify(uo2))
}

export default deploySimpleAccountFactory
