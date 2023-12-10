import { Signer } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'

import { RIP7560NonceManager, RIP7560NonceManager__factory } from '../../typechain'
import { bufferToHex, toChecksumAddress } from 'ethereumjs-util'

describe.only('RIP7560NonceManager', function () {
  let signer: Signer

  let nm: RIP7560NonceManager
  let accountEP: string
  let account2: string

  before(async function () {
    signer = ethers.provider.getSigner(accountEP);
    [accountEP, account2] = await ethers.provider.listAccounts()
    nm = await new RIP7560NonceManager__factory(signer).deploy(accountEP)
  })

  it('should increase nonce when called from EntryPoint', async function () {
    const key = 'deadbeef'.repeat(6)
    const nonce = '00'.repeat(80)
    const data = '0x' + account2.replace('0x', '') + key + nonce
    const nonceBefore = await ethers.provider.call({ to: nm.address, data, from: account2 })
    const tx = await signer.sendTransaction({
      to: nm.address,
      data
    })
    await expect(tx).to
      .emit(nm, 'NonceIncrease')
      .withArgs(account2, '0x' + key, 1)
    const nonceAfter = await ethers.provider.call({ to: nm.address, data, from: account2 })
    expect(parseInt(nonceBefore)).to.equal(0)
    expect(parseInt(nonceAfter)).to.equal(1)
  })

  it('should revert when called from EntryPoint with incorrect nonce', async function () {
    const key = 'deadbeef'.repeat(6)
    const nonce = 'aa'.repeat(80)
    const data = '0x' + account2.replace('0x', '') + key + nonce
    await expect(signer.sendTransaction(
      {
        to: nm.address,
        data
      })
    ).to.be.revertedWith('nonce mismatch')
  })
})
