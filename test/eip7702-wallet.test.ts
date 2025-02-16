import { expect } from 'chai'

import { Simple7702Account, Simple7702Account__factory, EntryPoint, TestPaymasterAcceptAll__factory } from '../typechain'
import { createAccountOwner, createAddress, deployEntryPoint } from './testutils'
import { fillAndSign, INITCODE_EIP7702_MARKER, packUserOp } from './UserOp'
import { hexConcat, parseEther } from 'ethers/lib/utils'
import { signEip7702Authorization } from './eip7702helpers'
import { GethExecutable } from './GethExecutable'
import { Wallet } from 'ethers'

describe('Simple7702Account.sol', function () {
  // can't deploy coverage "entrypoint" on geth (contract too large)
  if (process.env.COVERAGE != null) {
    return
  }

  let entryPoint: EntryPoint

  let eip7702delegate: Simple7702Account
  let geth: GethExecutable

  before(async function () {
    geth = new GethExecutable()
    await geth.init()

    entryPoint = await deployEntryPoint(geth.provider)

    eip7702delegate = await new Simple7702Account__factory(geth.provider.getSigner()).deploy()
    expect(await eip7702delegate.entryPoint()).to.equal(entryPoint.address, 'fix entryPoint in Simple7702Account.sol')
    console.log('set eip7702delegate=', eip7702delegate.address)
  })

  after(() => {
    geth.done()
  })

  describe('sanity: normal 7702 batching', () => {
    let eoa: Wallet
    before(async () => {
      eoa = createAccountOwner(geth.provider)

      const auth = await signEip7702Authorization(eoa, {
        chainId: 0,
        nonce: 0,
        address: eip7702delegate.address
      })
      const sendVal = parseEther('10')
      const tx = {
        to: eoa.address,
        value: sendVal.toHexString(),
        gas: 1e6,
        authorizationList: [auth]
      }
      await geth.sendTx(tx)
      expect(await geth.provider.getBalance(eoa.address)).to.equal(sendVal)
      expect(await geth.provider.getCode(eoa.address)).to.equal(hexConcat(['0xef0100', eip7702delegate.address]))
    })

    it('should fail call from another account', async () => {
      const wallet1 = Simple7702Account__factory.connect(eoa.address, geth.provider.getSigner())
      await expect(wallet1.executeBatch([])).to.revertedWith('not from self or EntryPoint')
    })

    it('should succeed sending a batch', async () => {
      // submit a batch
      const wallet2 = Simple7702Account__factory.connect(eoa.address, eoa)
      console.log('eoa balance=', await geth.provider.getBalance(eoa.address))

      const addr1 = createAddress()
      const addr2 = createAddress()

      await wallet2.executeBatch([{
        target: addr1, value: 1, data: '0x'
      }, {
        target: addr2, value: 2, data: '0x'
      }]).then(async tx => tx.wait())
      expect(await geth.provider.getBalance(addr1)).to.equal(1)
      expect(await geth.provider.getBalance(addr2)).to.equal(2)
    })
  })

  it('should be able to use EntryPoint without paymaster', async () => {
    const addr1 = createAddress()
    const eoa = createAccountOwner(geth.provider)

    const callData = eip7702delegate.interface.encodeFunctionData('execute', [addr1, 1, '0x'])
    const userop = await fillAndSign({
      sender: eoa.address,
      initCode: INITCODE_EIP7702_MARKER,
      nonce: 0,
      callData
    }, eoa, entryPoint, { eip7702delegate: eip7702delegate.address })

    await geth.sendTx({ to: eoa.address, value: parseEther('1') })
    const auth = await signEip7702Authorization(eoa, { chainId: 0, nonce: 0, address: eip7702delegate.address })
    const beneficiary = createAddress()
    // submit separate tx with tuple: geth's estimateGas doesn't work, and its easier to detect thrown errors..
    await geth.sendTx({
      to: entryPoint.address,
      data: '0x',
      gas: 1000000,
      authorizationList: [auth]
    })
    const handleOps = entryPoint.interface.encodeFunctionData('handleOps', [[packUserOp(userop)], beneficiary])
    const tx = {
      to: entryPoint.address,
      data: handleOps
    }
    await geth.sendTx(tx)
  })

  it('should use EntryPoint with paymaster', async () => {
    const addr1 = createAddress()
    const eoa = createAccountOwner(geth.provider)
    const paymaster = await new TestPaymasterAcceptAll__factory(geth.provider.getSigner()).deploy(entryPoint.address)
    await paymaster.deposit({ value: parseEther('1') })
    const callData = eip7702delegate.interface.encodeFunctionData('execute', [addr1, 1, '0x'])
    const userop = await fillAndSign({
      sender: eoa.address,
      paymaster: paymaster.address,
      initCode: INITCODE_EIP7702_MARKER,
      nonce: 0,
      callData
    }, eoa, entryPoint, { eip7702delegate: eip7702delegate.address })

    const auth = await signEip7702Authorization(eoa, { chainId: 0, nonce: 0, address: eip7702delegate.address })
    const beneficiary = createAddress()
    console.log('delegate=', eip7702delegate.address)
    // submit separate tx with tuple: geth's estimateGas doesn't work, and its easier to detect thrown errors..
    await geth.sendTx({
      to: entryPoint.address,
      data: '0x',
      gas: 1000000,
      authorizationList: [auth]
    })
    const handleOps = entryPoint.interface.encodeFunctionData('handleOps', [[packUserOp(userop)], beneficiary])
    const tx = {
      to: entryPoint.address,
      data: handleOps
    }
    await geth.sendTx(tx)
  })
})
