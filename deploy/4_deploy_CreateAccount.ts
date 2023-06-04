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

  console.log("==Created account==", accountAddress)


  const account = await ethers.getContractAt('SimpleAccount', accountAddress)
  const entryPointFullContract = await ethers.getContractAt('EntryPoint', entrypoint.address)
  const paymasterFullContract = await ethers.getContractAt('TokenPaymaster', paymaster.address)

  const updateEntryPoint = await account.populateTransaction.withdrawDepositTo(AddressZero, 0).then(tx => tx.data!)
  const calldata = await account.populateTransaction.execute(account.address, 0, updateEntryPoint).then(tx => tx.data!)

  const accountOwnerSigner = provider.getSigner(accountOwner)


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
