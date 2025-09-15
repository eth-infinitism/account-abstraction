import './aa.init'

import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import { Wallet } from 'ethers'
import { toChecksumAddress } from 'ethereumjs-util'
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
import {
  getEip7702AuthorizationSigner,
  gethHex,
  signEip7702Authorization,
  signEip7702RawTransaction
} from './eip7702helpers'
import { UserOperation } from './UserOperation'

async function sleep (number: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, number))
}

chai.use(chaiAsPromised)
const expect = chai.expect

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
        const hash = getUserOpHash({ ...userop, factory: mockDelegate }, entryPoint.address, chainId)
        expect(getUserOpHashWithEip7702({
          ...userop,
          isEip7702: true
        }, entryPoint.address, chainId, mockDelegate)).to.eql(hash)
      })
      it('#getUserOpHashWith7702 with initcode', async () => {
        const hash = getUserOpHash({ ...userop, factory: mockDelegate, factoryData: '0xb1ab1a' }, entryPoint.address, chainId)
        expect(getUserOpHashWithEip7702({
          ...userop,
          isEip7702: true,
          factoryData: '0xb1ab1a'
        }, entryPoint.address, chainId, mockDelegate)).to.eql(hash)
      })
    })

    describe('entryPoint getUserOpHash', () => {
      it('should return the same hash as calculated locally', async () => {
        const op1: UserOperation = { ...userop, isEip7702: true }
        expect(await callGetUserOpHashWithCode(entryPoint, op1, deployedDelegateCode)).to.eql(
          getUserOpHashWithEip7702(op1, entryPoint.address, chainId, mockDelegate))
      })

      it('should fail getUserOpHash marked for eip-7702, without a delegate', async () => {
        const op1: UserOperation = { ...userop, isEip7702: true }
        await expect(callGetUserOpHashWithCode(entryPoint, op1, '0x' + '00'.repeat(23)).catch(e => {
          throw new Error(decodeRevertReason(e.data)!)
        })).to.be.rejectedWith(`Eip7702SenderNotDelegate(${toChecksumAddress(op1.sender)})`)
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
        let bundler: Wallet
        let entryPoint: EntryPoint

        before(async () => {
          this.timeout(20000)
          geth = new GethExecutable()
          await geth.init()
          eoa = createAccountOwner(geth.provider)
          bundler = createAccountOwner(geth.provider)
          entryPoint = await deployEntryPoint(geth.provider)
          delegate = await new TestEip7702DelegateAccount__factory(geth.provider.getSigner()).deploy(entryPoint.address)
          console.log('\tdelegate addr=', delegate.address, 'len=', await geth.provider.getCode(delegate.address).then(code => code.length))
          await geth.sendTx({ to: eoa.address, value: gethHex(parseEther('1')) })
          await geth.sendTx({ to: bundler.address, value: gethHex(parseEther('1')) })
        })

        it('should fail without sender delegate', async () => {
          const eip7702userOp = await fillSignAndPack({
            sender: eoa.address,
            nonce: 0,
            isEip7702: true
          }, eoa, entryPoint, { eip7702delegate: delegate.address })
          const handleOpCall = {
            to: entryPoint.address,
            data: entryPoint.interface.encodeFunctionData('handleOps', [[eip7702userOp], beneficiary]),
            gasLimit: 1000000
            // authorizationList: [eip7702tuple]
          }
          await expect(geth.call(handleOpCall).catch(e => {
            throw new Error(decodeRevertReason(e.error.data)!)
          })).to.rejectedWith(`Eip7702SenderWithoutCode(${toChecksumAddress(eoa.address)})`)
        })

        it('should succeed with authorizationList', async () => {
          const eip7702userOp = await fillAndSign({
            sender: eoa.address,
            nonce: 0,
            isEip7702: true
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

        it('should succeed and call initcode', async () => {
          const eip7702userOp = await fillSignAndPack({
            sender: eoa.address,
            nonce: 0,
            isEip7702: true,
            factoryData: delegate.interface.encodeFunctionData('testInit')
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
          // note: we are now sending the actual tx from the EOA, so the authorization nonce has to be incremented first
          // handleOpCall.authorizationList[0] = await signEip7702Authorization(eoa, {
          //   address: delegate.address,
          //   nonce: await geth.provider.getTransactionCount(eoa.address) + 1,
          //   chainId: await geth.provider.getNetwork().then(net => net.chainId)
          // })
          const rawTx = await signEip7702RawTransaction(bundler, handleOpCall)
          const txHash = await geth.provider.send('eth_sendRawTransaction', [rawTx])
          await sleep(100)
          const receipt = await geth.provider.getTransactionReceipt(txHash)

          // Check if EIP-7702 authorization was applied correctly
          const eoaCode = await geth.provider.getCode(eoa.address)
          const eoaAsDelegate = new TestEip7702DelegateAccount__factory(geth.provider.getSigner()).attach(eoa.address)
          expect(eoaCode).to.equal(`0xef0100${delegate.address.toLowerCase().slice(2)}`, 'EOA code should contain the delegate address')
          expect(receipt.status).to.equal(1, 'handleOps failed')
          expect(await eoaAsDelegate.testInitCalled()).to.be.true

          // cannot use 'expectEvent' because the transaction needs to be mined first for the receipt checks
          const initEvent = receipt.logs
            .map(log => {
              try {
                return entryPoint.interface.parseLog(log)
              } catch {
                return null
              }
            })
            .filter(event => event !== null)
            .find(event => event?.name === 'EIP7702AccountInitialized')

          expect(initEvent).to.exist
          expect(initEvent?.args[1]).to.equal(eoa.address)
          expect(initEvent?.args[2]).to.equal(delegate.address)
        })

        after(async () => {
          geth.done()
        })
      })
    })
  })
})
