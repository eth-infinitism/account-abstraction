import { ethers } from 'hardhat'
import { Wallet } from 'ethers'
import { fillUserOp, signUserOp } from '../test/UserOp'
import { UserOperation } from '../test/UserOperation'
import { TestCounter, TestExpiryAccount } from '../typechain'

async function createUserOp(
  entryPointAddr: string,
  signer: Wallet,
  testCounter: TestCounter,
  testExpiryAccount: TestExpiryAccount, 
  beneficiary: string 
) {
    const count = testCounter.interface.encodeFunctionData('count')
    // Creating UserOp executing count() function in TestCounter contract
    const callData = testExpiryAccount.interface.encodeFunctionData('execute', [testCounter.address, 0, count])
    const op: Partial<UserOperation> = {
        sender: testExpiryAccount.address,
        initCode: '0x',
        callData: callData,
        paymasterAndData: '0x',
        verificationGasLimit: 5e5
    }

    const entryPoint = await ethers.getContractAt('EntryPoint', entryPointAddr)
    console.log(entryPoint.address)
    const filledOp = await fillUserOp(op, entryPoint)
    const chainId = 5
    const signedOp = signUserOp(filledOp, signer, entryPointAddr, chainId)
    console.log('Signed user operation:', signedOp.signature)

    await entryPoint.connect(signer)

    const tx = await entryPoint.handleOps([signedOp], beneficiary, {gasLimit: 10e6})
    await tx.wait()
    console.log(tx)
    return tx.hash
}

export default createUserOp;