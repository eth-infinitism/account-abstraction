import './aa.init'
import { Wallet } from 'ethers'
import { expect } from 'chai'
import {
  EntryPoint,
  TestEip7702DelegateAccount,
  TestEip7702DelegateAccount__factory,
  TestUtil,
  TestUtil__factory
} from '../typechain'
import {
  callGetUserOpHashWithCode,
  createAccountOwner,
  createAddress,
  decodeRevertReason,
  deployEntryPoint
} from './testutils'
import {
  INITCODE_EIP7702_MARKER,
  fillAndSign,
  fillSignAndPack,
  fillUserOpDefaults,
  getUserOpHash,
  getUserOpHashWithEip7702,
  packUserOp
} from './UserOp'
import { ethers } from 'hardhat'
import { hexConcat, parseEther } from 'ethers/lib/utils'
import { before } from 'mocha'
import { GethExecutable } from './GethExecutable'
import { getEip7702AuthorizationSigner, gethHex, signEip7702Authorization } from './eip7702helpers'

describe('EntryPoint EIP-7702 tests', function () {
  const ethersSigner = ethers.provider.getSigner()

  // use stateOverride to "inject" 7702 delegate code to check the generated UserOpHash
  describe('userOpHash with eip-7702 account', () => {
    const userop = fillUserOpDefaults({
      sender: createAddress(),
      nonce: 1,
      callData: '0xdead',
      callGasLimit: 2,
      verificationGasLimit: 3,
      maxFeePerGas: 4
    })
    let chainId: number

    let entryPoint: EntryPoint
    const mockDelegate = createAddress()

    const deployedDelegateCode = hexConcat(['0xef0100', mockDelegate])

    before(async function () {
      this.timeout(20000)
      chainId = await ethers.provider.getNetwork().then(net => net.chainId)
      entryPoint = await deployEntryPoint()
    })

    describe('#_isEip7702InitCode', () => {
      let testUtil: TestUtil
      before(async () => {
        testUtil = await new TestUtil__factory(ethersSigner).deploy()
      });

      [1, 10, 20, 30].forEach(pad =>
        it(`should accept initCode with zero pad ${pad}`, async () => {
          expect(await testUtil.isEip7702InitCode(INITCODE_EIP7702_MARKER + '00'.repeat(pad))).to.be.true
        })
      )

      it('should accept initCode with just prefix', async () => {
        expect(await testUtil.isEip7702InitCode(INITCODE_EIP7702_MARKER)).to.be.true
      })

      it('should not accept EIP7702 if first 20 bytes contain non-zero', async () => {
        const addr = INITCODE_EIP7702_MARKER + '0'.repeat(40 - INITCODE_EIP7702_MARKER.length) + '01'
        expect(addr.length).to.eql(42)
        expect(await testUtil.isEip7702InitCode(addr)).to.be.false
      })
    })

    describe('check 7702 utility functions helpers', () => {
      // sample valid auth:
      const authSigner = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
      // created using "cast call --auth"
      const authorizationList = [
        {
          chainId: '0x539',
          address: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
          nonce: '0x2',
          yParity: '0x0',
          r: '0x8812962756107260d0c7934e0ea656ede2f953f2250a406d34be2605499134b4',
          s: '0x43a2f470a01de2b68f4e9b31d7bef91188f1ab81fb95c732958398b17c7af8f6'
        }
      ]
      it('#getEip7702AuthorizationSigner', async () => {
        const auth = authorizationList[0]
        const signer = getEip7702AuthorizationSigner(auth)
        expect(signer).to.eql(authSigner.address)
      })

      it('#signEip7702Authorization', async () => {
        // deliberately remove previous signature...
        const authToSign = { address: createAddress(), nonce: 12345, chainId: '0x0' }
        const signed = await signEip7702Authorization(authSigner, authToSign)
        expect(getEip7702AuthorizationSigner(signed)).to.eql(authSigner.address)
      })
    })

    it('calculate userophash with normal account', async () => {
      expect(getUserOpHash(userop, entryPoint.address, chainId)).to.eql(await entryPoint.getUserOpHash(packUserOp(userop)))
    })

    describe('#getUserOpHashWith7702', () => {
      it('#getUserOpHashWith7702 just delegate', async () => {
        const hash = getUserOpHash({ ...userop, initCode: mockDelegate }, entryPoint.address, chainId)
        expect(getUserOpHashWithEip7702({
          ...userop,
          initCode: INITCODE_EIP7702_MARKER
        }, entryPoint.address, chainId, mockDelegate)).to.eql(hash)
      })
      it('#getUserOpHashWith7702 with initcode', async () => {
        const hash = getUserOpHash({ ...userop, initCode: mockDelegate + 'b1ab1a' }, entryPoint.address, chainId)
        expect(getUserOpHashWithEip7702({
          ...userop,
          initCode: INITCODE_EIP7702_MARKER.padEnd(42, '0') + 'b1ab1a'
        }, entryPoint.address, chainId, mockDelegate)).to.eql(hash)
      })
    })

    describe('entryPoint getUserOpHash', () => {
      it('should return the same hash as calculated locally', async () => {
        const op1 = { ...userop, initCode: INITCODE_EIP7702_MARKER }
        expect(await callGetUserOpHashWithCode(entryPoint, op1, deployedDelegateCode)).to.eql(
          getUserOpHashWithEip7702(op1, entryPoint.address, chainId, mockDelegate))
      })

      it('should fail getUserOpHash marked for eip-7702, without a delegate', async () => {
        const op1 = { ...userop, initCode: INITCODE_EIP7702_MARKER }
        await expect(callGetUserOpHashWithCode(entryPoint, op1, '0x' + '00'.repeat(23)).catch(e => { throw e.error ?? e.message })).to.revertedWith('not an EIP-7702 delegate')
      })

      it('should allow initCode with INITCODE_EIP7702_MARKER tailed with zeros only, ', async () => {
        const op_zero_tail = { ...userop, initCode: INITCODE_EIP7702_MARKER + '00'.repeat(10) }
        expect(await callGetUserOpHashWithCode(entryPoint, op_zero_tail, deployedDelegateCode)).to.eql(
          getUserOpHashWithEip7702(op_zero_tail, entryPoint.address, chainId, mockDelegate))

        op_zero_tail.initCode = INITCODE_EIP7702_MARKER + '00'.repeat(30)
        expect(await callGetUserOpHashWithCode(entryPoint, op_zero_tail, deployedDelegateCode)).to.eql(
          getUserOpHashWithEip7702(op_zero_tail, entryPoint.address, chainId, mockDelegate))
      })

      describe('test with geth', () => {
        // can't deploy coverage "entrypoint" on geth (contract too large)
        if (process.env.COVERAGE != null) {
          return
        }

        let geth: GethExecutable
        let delegate: TestEip7702DelegateAccount
        const beneficiary = createAddress()
        let eoa: Wallet
        let entryPoint: EntryPoint

        before(async () => {
          this.timeout(20000)
          geth = new GethExecutable()
          await geth.init()
          eoa = createAccountOwner(geth.provider)
          entryPoint = await deployEntryPoint(geth.provider)
          delegate = await new TestEip7702DelegateAccount__factory(geth.provider.getSigner()).deploy()
          console.log('\tdelegate addr=', delegate.address, 'len=', await geth.provider.getCode(delegate.address).then(code => code.length))
          await geth.sendTx({ to: eoa.address, value: gethHex(parseEther('1')) })
        })

        it('should fail without sender delegate', async () => {
          const eip7702userOp = await fillSignAndPack({
            sender: eoa.address,
            nonce: 0,
            initCode: INITCODE_EIP7702_MARKER // not init function, just delegate
          }, eoa, entryPoint, { eip7702delegate: delegate.address })
          const handleOpCall = {
            to: entryPoint.address,
            data: entryPoint.interface.encodeFunctionData('handleOps', [[eip7702userOp], beneficiary]),
            gasLimit: 1000000
            // authorizationList: [eip7702tuple]
          }
          expect(await geth.call(handleOpCall).catch(e => {
            return e.error
          })).to.match(/not an EIP-7702 delegate|sender has no code/)
        })

        it('should succeed with authorizationList', async () => {
          const eip7702userOp = await fillAndSign({
            sender: eoa.address,
            nonce: 0,
            initCode: INITCODE_EIP7702_MARKER // not init function, just delegate
          }, eoa, entryPoint, { eip7702delegate: delegate.address })
          const eip7702tuple = await signEip7702Authorization(eoa, {
            address: delegate.address,
            nonce: await geth.provider.getTransactionCount(eoa.address),
            chainId: await geth.provider.getNetwork().then(net => net.chainId)
          })

          const handleOpCall = {
            to: entryPoint.address,
            data: entryPoint.interface.encodeFunctionData('handleOps', [[packUserOp(eip7702userOp)], beneficiary]),
            gasLimit: 1000000,
            authorizationList: [eip7702tuple]
          }

          await geth.call(handleOpCall).catch(e => {
            throw Error(decodeRevertReason(e)!)
          })
        })

        // skip until auth works.
        it('should succeed and call initcode', async () => {
          const eip7702userOp = await fillSignAndPack({
            sender: eoa.address,
            nonce: 0,
            initCode: hexConcat([INITCODE_EIP7702_MARKER + '0'.repeat(42 - INITCODE_EIP7702_MARKER.length), delegate.interface.encodeFunctionData('testInit')])
          }, eoa, entryPoint, { eip7702delegate: delegate.address })

          const eip7702tuple = await signEip7702Authorization(eoa, {
            address: delegate.address,
            // nonce: await geth.provider.getTransactionCount(eoa.address),
            chainId: await geth.provider.getNetwork().then(net => net.chainId)
          })
          const handleOpCall = {
            to: entryPoint.address,
            data: entryPoint.interface.encodeFunctionData('handleOps', [[eip7702userOp], beneficiary]),
            gasLimit: 1000000,
            authorizationList: [eip7702tuple]
          }
          await geth.call(handleOpCall).catch(e => {
            throw Error(decodeRevertReason(e)!)
          })
        })

        after(async () => {
          geth.done()
        })
      })
    })
  })
})
