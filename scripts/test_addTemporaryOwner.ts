import { ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

const hre: HardhatRuntimeEnvironment = require('hardhat')

async function addTemporaryOwner(
    testAccount: string,
    targetMethods: any,
    signer: string,
) {
    const ownerAccount = (await ethers.getSigners())[0];
    const testExpiryAccount = await hre.ethers.getContractAt('TestExpiryAccount', testAccount)
    let now = await hre.ethers.provider.getBlock('latest').then(block => block.timestamp)
    const tx = await testExpiryAccount.connect(ownerAccount).addTemporaryOwner(
      signer, 
      now - 2000, 
      now + 20000, 
      targetMethods,
      {
        gasPrice: 5e5
      }
    )
    await tx.wait()
    return tx.hash
}

export default addTemporaryOwner;