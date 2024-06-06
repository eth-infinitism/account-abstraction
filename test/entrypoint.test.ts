import './aa.init'
import { BigNumber, Event, Wallet } from 'ethers'
import { expect } from 'chai'
import {
  SimpleAccount,
  SimpleAccountFactory,
  TestAggregatedAccount__factory,
  TestAggregatedAccountFactory__factory,
  TestCounter,
  TestCounter__factory,
  TestExpirePaymaster,
  TestExpirePaymaster__factory,
  TestExpiryAccount,
  TestExpiryAccount__factory,
  TestPaymasterAcceptAll,
  TestPaymasterAcceptAll__factory,
  TestRevertAccount__factory,
  TestAggregatedAccount,
  TestSignatureAggregator,
  TestSignatureAggregator__factory,
  MaliciousAccount__factory,
  TestWarmColdAccount__factory,
  TestPaymasterRevertCustomError__factory,
  IEntryPoint__factory,
  SimpleAccountFactory__factory,
  IStakeManager__factory,
  INonceManager__factory,
  EntryPoint,
  TestPaymasterWithPostOp__factory,
  TestPaymasterWithPostOp
} from '../typechain'
import {
  AddressZero,
  createAccountOwner,
  fund,
  checkForGeth,
  rethrow,
  tostr,
  getAccountInitCode,
  calcGasUsage,
  ONE_ETH,
  TWO_ETH,
  deployEntryPoint,
  getBalance,
  createAddress,
  getAccountAddress,
  HashZero,
  createAccount,
  getAggregatedAccountInitCode,
  decodeRevertReason, parseValidationData, findUserOpWithMin
} from './testutils'
import { DefaultsForUserOp, fillAndSign, fillSignAndPack, getUserOpHash, packUserOp, simulateValidation } from './UserOp'
import { PackedUserOperation, UserOperation } from './UserOperation'
import { PopulatedTransaction } from 'ethers/lib/ethers'
import { ethers } from 'hardhat'
import { arrayify, defaultAbiCoder, hexZeroPad, parseEther } from 'ethers/lib/utils'
import { debugTransaction } from './debugTx'
import { BytesLike } from '@ethersproject/bytes'
import { toChecksumAddress } from 'ethereumjs-util'
import { getERC165InterfaceID } from '../src/Utils'
import { UserOperationEventEvent } from '../typechain/contracts/interfaces/IEntryPoint'

describe('EntryPoint', function () {
  let entryPoint: EntryPoint
  let simpleAccountFactory: SimpleAccountFactory

  let accountOwner: Wallet
  const ethersSigner = ethers.provider.getSigner()
  let account: SimpleAccount

  const globalUnstakeDelaySec = 2
  const paymasterStake = ethers.utils.parseEther('2')

  before(async function () {
    this.timeout(20000)
    await checkForGeth()

    const chainId = await ethers.provider.getNetwork().then(net => net.chainId)

    entryPoint = await deployEntryPoint()

    accountOwner = createAccountOwner();
    ({
      proxy: account,
      accountFactory: simpleAccountFactory
    } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address))
    await fund(account)

    // sanity: validate helper functions
    const sampleOp = await fillAndSign({ sender: account.address }, accountOwner, entryPoint)
    const packedOp = packUserOp(sampleOp)
    expect(getUserOpHash(sampleOp, entryPoint.address, chainId)).to.eql(await entryPoint.getUserOpHash(packedOp))
  })

  describe('Stake Management', () => {
    let addr: string
    before(async () => {
      addr = await ethersSigner.getAddress()
    })

    it('should deposit for transfer into EntryPoint', async () => {
      const signer2 = ethers.provider.getSigner(2)
      await signer2.sendTransaction({ to: entryPoint.address, value: ONE_ETH })
      expect(await entryPoint.balanceOf(await signer2.getAddress())).to.eql(ONE_ETH)
      expect(await entryPoint.getDepositInfo(await signer2.getAddress())).to.eql({
        deposit: ONE_ETH,
        staked: false,
        stake: 0,
        unstakeDelaySec: 0,
        withdrawTime: 0
      })
    })

    describe('without stake', () => {
      it('should fail to stake without value', async () => {
        await expect(entryPoint.addStake(2)).to.revertedWith('no stake specified')
      })
      it('should fail to stake without delay', async () => {
        await expect(entryPoint.callStatic.addStake(0, { value: ONE_ETH })).to.revertedWith('must specify unstake delay')
      })
      it('should fail to unlock', async () => {
        await expect(entryPoint.callStatic.unlockStake()).to.revertedWith('not staked')
      })
    })
    describe('with stake of 2 eth', () => {
      before(async () => {
        await entryPoint.addStake(2, { value: TWO_ETH })
      })
      it('should report "staked" state', async () => {
        const { stake, staked, unstakeDelaySec, withdrawTime } = await entryPoint.getDepositInfo(addr)
        expect({ stake, staked, unstakeDelaySec, withdrawTime }).to.eql({
          stake: parseEther('2'),
          staked: true,
          unstakeDelaySec: 2,
          withdrawTime: 0
        })
      })

      it('should succeed to stake again', async () => {
        const { stake } = await entryPoint.getDepositInfo(addr)
        await entryPoint.addStake(2, { value: ONE_ETH })
        const { stake: stakeAfter } = await entryPoint.getDepositInfo(addr)
        expect(stakeAfter).to.eq(stake.add(ONE_ETH))
      })
      it('should fail to withdraw before unlock', async () => {
        await expect(entryPoint.withdrawStake(AddressZero)).to.revertedWith('must call unlockStake() first')
      })
      describe('with unlocked stake', () => {
        before(async () => {
          await entryPoint.unlockStake()
        })
        it('should report as "not staked"', async () => {
          expect(await entryPoint.getDepositInfo(addr).then(info => info.staked)).to.eq(false)
        })
        it('should report unstake state', async () => {
          const withdrawTime1 = await ethers.provider.getBlock('latest').then(block => block.timestamp) + globalUnstakeDelaySec
          const { stake, staked, unstakeDelaySec, withdrawTime } = await entryPoint.getDepositInfo(addr)
          expect({ stake, staked, unstakeDelaySec, withdrawTime }).to.eql({
            stake: parseEther('3'),
            staked: false,
            unstakeDelaySec: 2,
            withdrawTime: withdrawTime1
          })
        })
        it('should fail to withdraw before unlock timeout', async () => {
          await expect(entryPoint.withdrawStake(AddressZero)).to.revertedWith('Stake withdrawal is not due')
        })
        it('should fail to unlock again', async () => {
          await expect(entryPoint.callStatic.unlockStake()).to.revertedWith('already unstaking')
        })
        describe('after unstake delay', () => {
          before(async () => {
            // dummy transaction and increase time by 2 seconds
            await ethers.provider.send('evm_increaseTime', [2])
            await ethersSigner.sendTransaction({ to: addr })
          })
          it('adding stake should reset "unlockStake"', async () => {
            let snap
            try {
              snap = await ethers.provider.send('evm_snapshot', [])

              await ethersSigner.sendTransaction({ to: addr })
              await entryPoint.addStake(2, { value: ONE_ETH })
              const { stake, staked, unstakeDelaySec, withdrawTime } = await entryPoint.getDepositInfo(addr)
              expect({ stake, staked, unstakeDelaySec, withdrawTime }).to.eql({
                stake: parseEther('4'),
                staked: true,
                unstakeDelaySec: 2,
                withdrawTime: 0
              })
            } finally {
              await ethers.provider.send('evm_revert', [snap])
            }
          })

          it('should fail to unlock again', async () => {
            await expect(entryPoint.callStatic.unlockStake()).to.revertedWith('already unstaking')
          })
          it('should succeed to withdraw', async () => {
            const { stake } = await entryPoint.getDepositInfo(addr)
            const addr1 = createAddress()
            await entryPoint.withdrawStake(addr1)
            expect(await ethers.provider.getBalance(addr1)).to.eq(stake)
            const { stake: stakeAfter, withdrawTime, unstakeDelaySec } = await entryPoint.getDepositInfo(addr)

            expect({ stakeAfter, withdrawTime, unstakeDelaySec }).to.eql({
              stakeAfter: BigNumber.from(0),
              unstakeDelaySec: 0,
              withdrawTime: 0
            })
          })
        })
      })
    })
    describe('with deposit', () => {
      let account: SimpleAccount
      before(async () => {
        ({ proxy: account } = await createAccount(ethersSigner, await ethersSigner.getAddress(), entryPoint.address, simpleAccountFactory))
        await account.addDeposit({ value: ONE_ETH })
        expect(await getBalance(account.address)).to.equal(0)
        expect(await account.getDeposit()).to.eql(ONE_ETH)
      })
      it('should be able to withdraw', async () => {
        const depositBefore = await account.getDeposit()
        await account.withdrawDepositTo(account.address, ONE_ETH)
        expect(await getBalance(account.address)).to.equal(1e18)
        expect(await account.getDeposit()).to.equal(depositBefore.sub(ONE_ETH))
      })
    })
  })
  describe('#simulateValidation', () => {
    const accountOwner1 = createAccountOwner()

    // note: for the actual opcode and storage rule restrictions see the reference bundler ValidationManager
    it('should not use banned ops during simulateValidation', async () => {
      const op1 = await fillSignAndPack({
        initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory),
        sender: await getAccountAddress(accountOwner1.address, simpleAccountFactory)
      }, accountOwner1, entryPoint)
      await fund(op1.sender)
      await simulateValidation(op1, entryPoint.address, { gasLimit: 10e6 })
      // TODO: can't do opcode banning with EntryPointSimulations (since its not on-chain) add when we can debug_traceCall
      // const block = await ethers.provider.getBlock('latest')
      // const hash = block.transactions[0]
      // await checkForBannedOps(hash, false)
    })
  })

  describe('flickering account validation', () => {
    it('should prevent leakage of basefee', async function () {
      if (process.env.COVERAGE != null) {
        // coverage disables block.baseFee, which breaks this test...
        // it also doesn't add to EntryPoint's coverage
        this.skip()
      }

      const maliciousAccount = await new MaliciousAccount__factory(ethersSigner).deploy(entryPoint.address,
        { value: parseEther('1') })

      const snap = await ethers.provider.send('evm_snapshot', [])
      await ethers.provider.send('evm_mine', [])
      const block = await ethers.provider.getBlock('latest')
      await ethers.provider.send('evm_revert', [snap])

      if (block.baseFeePerGas == null) {
        expect.fail(null, null, 'test error: no basefee')
      }

      const userOp: UserOperation = {
        sender: maliciousAccount.address,
        nonce: await entryPoint.getNonce(maliciousAccount.address, 0),
        signature: defaultAbiCoder.encode(['uint256'], [block.baseFeePerGas]),
        initCode: '0x',
        callData: '0x',
        callGasLimit: '0x' + 1e5.toString(16),
        verificationGasLimit: '0x' + 1e5.toString(16),
        preVerificationGas: '0x' + 1e5.toString(16),
        // we need maxFeeperGas > block.basefee + maxPriorityFeePerGas so requiredPrefund onchain is basefee + maxPriorityFeePerGas
        maxFeePerGas: block.baseFeePerGas.mul(3),
        maxPriorityFeePerGas: block.baseFeePerGas,
        paymaster: AddressZero,
        paymasterData: '0x',
        paymasterVerificationGasLimit: 0,
        paymasterPostOpGasLimit: 0
      }
      const userOpPacked = packUserOp(userOp)
      try {
        await simulateValidation(userOpPacked, entryPoint.address, { gasLimit: 1e6 })

        console.log('after first simulation')
        await ethers.provider.send('evm_mine', [])
        await expect(simulateValidation(userOpPacked, entryPoint.address, { gasLimit: 1e6 }))
          .to.revertedWith('Revert after first validation')
        // if we get here, it means the userOp passed first sim and reverted second
        expect.fail(null, null, 'should fail on first simulation')
      } catch (e: any) {
        expect(decodeRevertReason(e)).to.include('Revert after first validation')
      }
    })

    it('should limit revert reason length before emitting it', async () => {
      const revertLength = 1e5
      const REVERT_REASON_MAX_LEN = 2048
      const testRevertAccount = await new TestRevertAccount__factory(ethersSigner).deploy(entryPoint.address, { value: parseEther('1') })
      const badData = await testRevertAccount.populateTransaction.revertLong(revertLength + 1)
      const badOp: UserOperation = {
        ...DefaultsForUserOp,
        sender: testRevertAccount.address,
        callGasLimit: 1e5,
        maxFeePerGas: 1,
        nonce: await entryPoint.getNonce(testRevertAccount.address, 0),
        verificationGasLimit: 1e5,
        callData: badData.data!
      }
      const beneficiaryAddress = createAddress()
      const badOpPacked = packUserOp(badOp)
      await simulateValidation(badOpPacked, entryPoint.address, { gasLimit: 3e5 })

      const tx = await entryPoint.handleOps([badOpPacked], beneficiaryAddress) // { gasLimit: 3e5 })
      const receipt = await tx.wait()
      const userOperationRevertReasonEvent = receipt.events?.find(event => event.event === 'UserOperationRevertReason')
      expect(userOperationRevertReasonEvent?.event).to.equal('UserOperationRevertReason')
      const revertReason = Buffer.from(arrayify(userOperationRevertReasonEvent?.args?.revertReason))
      expect(revertReason.length).to.equal(REVERT_REASON_MAX_LEN)
    })
    describe('warm/cold storage detection in simulation vs execution', () => {
      const TOUCH_GET_AGGREGATOR = 1
      const TOUCH_PAYMASTER = 2
      it('should prevent detection through getAggregator()', async () => {
        const testWarmColdAccount = await new TestWarmColdAccount__factory(ethersSigner).deploy(entryPoint.address,
          { value: parseEther('1') })
        const badOp: UserOperation = {
          ...DefaultsForUserOp,
          nonce: TOUCH_GET_AGGREGATOR,
          sender: testWarmColdAccount.address
        }
        const badOpPacked = packUserOp(badOp)
        const beneficiaryAddress = createAddress()
        try {
          await simulateValidation(badOpPacked, entryPoint.address, { gasLimit: 1e6 })
          throw new Error('should revert')
        } catch (e: any) {
          if ((e as Error).message.includes('ValidationResult')) {
            const tx = await entryPoint.handleOps([badOpPacked], beneficiaryAddress, { gasLimit: 1e6 })
            await tx.wait()
          } else {
            expect(decodeRevertReason(e)).to.include('AA23 reverted')
          }
        }
      })

      it('should prevent detection through paymaster.code.length', async () => {
        const testWarmColdAccount = await new TestWarmColdAccount__factory(ethersSigner).deploy(entryPoint.address,
          { value: parseEther('1') })
        const paymaster = await new TestPaymasterAcceptAll__factory(ethersSigner).deploy(entryPoint.address)
        await paymaster.deposit({ value: ONE_ETH })
        const badOp: UserOperation = {
          ...DefaultsForUserOp,
          nonce: TOUCH_PAYMASTER,
          paymaster: paymaster.address,
          paymasterVerificationGasLimit: 150000,
          sender: testWarmColdAccount.address
        }
        const beneficiaryAddress = createAddress()
        const badOpPacked = packUserOp(badOp)
        try {
          await simulateValidation(badOpPacked, entryPoint.address, { gasLimit: 1e6 })
          throw new Error('should revert')
        } catch (e: any) {
          if ((e as Error).message.includes('ValidationResult')) {
            const tx = await entryPoint.handleOps([badOpPacked], beneficiaryAddress, { gasLimit: 1e6 })
            await tx.wait()
          } else {
            expect(decodeRevertReason(e)).to.include('AA23 reverted')
          }
        }
      })
    })
  })

  describe('2d nonces', () => {
    const beneficiaryAddress = createAddress()
    let sender: string
    const key = 1
    const keyShifted = BigNumber.from(key).shl(64)

    before(async () => {
      const { proxy } = await createAccount(ethersSigner, accountOwner.address, entryPoint.address)
      sender = proxy.address
      await fund(sender)
    })

    it('should fail nonce with new key and seq!=0', async () => {
      const op = await fillSignAndPack({
        sender,
        nonce: keyShifted.add(1)
      }, accountOwner, entryPoint)
      await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress)).to.revertedWith('AA25 invalid account nonce')
    })

    describe('with key=1, seq=1', () => {
      before(async () => {
        const op = await fillSignAndPack({
          sender,
          nonce: keyShifted
        }, accountOwner, entryPoint)
        await entryPoint.handleOps([op], beneficiaryAddress)
      })

      it('should get next nonce value by getNonce', async () => {
        expect(await entryPoint.getNonce(sender, key)).to.eql(keyShifted.add(1))
      })

      it('should allow to increment nonce of different key', async () => {
        const op = await fillSignAndPack({
          sender,
          nonce: await entryPoint.getNonce(sender, key)
        }, accountOwner, entryPoint)
        await entryPoint.callStatic.handleOps([op], beneficiaryAddress)
      })

      it('should allow manual nonce increment', async () => {
        // must be called from account itself
        const incNonceKey = 5
        const incrementCallData = entryPoint.interface.encodeFunctionData('incrementNonce', [incNonceKey])
        const callData = account.interface.encodeFunctionData('execute', [entryPoint.address, 0, incrementCallData])
        const op = await fillSignAndPack({
          sender,
          callData,
          nonce: await entryPoint.getNonce(sender, key)
        }, accountOwner, entryPoint)
        await entryPoint.handleOps([op], beneficiaryAddress)

        expect(await entryPoint.getNonce(sender, incNonceKey)).to.equal(BigNumber.from(incNonceKey).shl(64).add(1))
      })
      it('should fail with nonsequential seq', async () => {
        const op = await fillSignAndPack({
          sender,
          nonce: keyShifted.add(3)
        }, accountOwner, entryPoint)
        await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress)).to.revertedWith('AA25 invalid account nonce')
      })
    })
  })

  describe('without paymaster (account pays in eth)', () => {
    describe('#handleOps', () => {
      let counter: TestCounter
      let accountExecFromEntryPoint: PopulatedTransaction

      before(async () => {
        counter = await new TestCounter__factory(ethersSigner).deploy()
        const count = await counter.populateTransaction.count()
        accountExecFromEntryPoint = await account.populateTransaction.execute(counter.address, 0, count.data!)
      })

      it('should revert on signature failure', async () => {
        // wallet-reported signature failure should revert in handleOps
        const wrongOwner = createAccountOwner()
        const op = await fillSignAndPack({
          sender: account.address
        }, wrongOwner, entryPoint)
        const beneficiaryAddress = createAddress()
        await expect(entryPoint.estimateGas.handleOps([op], beneficiaryAddress)).to.revertedWith('AA24 signature error')
      })

      describe('should pay prefund and revert account if prefund is not enough', function () {
        const beneficiary = createAddress()
        const maxFeePerGas = 1
        const maxPriorityFeePerGas = 1
        let callData: string
        let nonce: number
        let paymaster: TestPaymasterWithPostOp
        let minCallGas: number

        async function createUserOpWithGas (vgl: number, pmVgl: number, cgl: number): Promise<UserOperation> {
          return fillAndSign({
            sender: account.address,
            nonce,
            callData,
            callGasLimit: cgl,
            paymaster: pmVgl > 0 ? paymaster.address : undefined,
            paymasterVerificationGasLimit: pmVgl > 0 ? pmVgl : undefined,
            maxFeePerGas,
            maxPriorityFeePerGas,
            verificationGasLimit: vgl
          }, accountOwner, entryPoint)
        }

        this.timeout(50000)
        before(async () => {
          const execCount = counter.interface.encodeFunctionData('count')
          callData = account.interface.encodeFunctionData('execute', [counter.address, 0, execCount])
          nonce = (await account.getNonce()).toNumber()
          paymaster = await new TestPaymasterWithPostOp__factory(ethersSigner).deploy(entryPoint.address)
          await entryPoint.depositTo(paymaster.address, { value: parseEther('1') })
          await entryPoint.depositTo(account.address, { value: parseEther('1') })

          // find minimum callGasLimit:
          minCallGas = await findUserOpWithMin(async (cgl: number) => createUserOpWithGas(5e5, 0, cgl), true, entryPoint, 1, 100000, 2)
        })

        let snapshot: any
        beforeEach(async () => {
          snapshot = await ethers.provider.send('evm_snapshot', [])
        })
        afterEach(async () => {
          await ethers.provider.send('evm_revert', [snapshot])
        })

        it('without paymaster', async function () {
          const vgl = await findUserOpWithMin(async (vgl: number) => createUserOpWithGas(vgl, 0, minCallGas), false, entryPoint, 5000, 100000, 2)

          const current = await counter.counters(account.address)
          // expect calldata to revert below minGas:
          const beneficiaryBalance = await ethers.provider.getBalance(beneficiary)
          const rcpt = await entryPoint.handleOps([packUserOp(await createUserOpWithGas(vgl - 1, 0, minCallGas))], beneficiary).then(async r => r.wait())
          expect(rcpt.events?.map(ev => ev.event)).to.eql([
            'BeforeExecution',
            'UserOperationPrefundTooLow',
            'UserOperationEvent'])
          const userOpEvent = rcpt.events?.find(e => e.event === 'UserOperationEvent') as UserOperationEventEvent
          const collected = (await ethers.provider.getBalance(beneficiary)).sub(beneficiaryBalance)
          expect(userOpEvent.args.actualGasCost).to.equal(collected)
          expect(await counter.counters(account.address)).to.eql(current, 'should revert account with prefund too low')
          expect(userOpEvent.args.success).to.eql(false)
        })

        it('with paymaster', async function () {
          const current = await counter.counters(account.address)

          const minVerGas = await findUserOpWithMin(async (vgl: number) => createUserOpWithGas(vgl, 1e5, minCallGas), false, entryPoint, 5000, 100000, 2)
          const minPmVerGas = await findUserOpWithMin(async (pmVgl: number) => createUserOpWithGas(minVerGas, pmVgl, minCallGas), false, entryPoint, 1, 100000, 2)

          const beneficiaryBalance = await ethers.provider.getBalance(beneficiary)
          const rcpt = await entryPoint.handleOps([packUserOp(await createUserOpWithGas(minVerGas, minPmVerGas - 1, minCallGas))], beneficiary)
            .then(async r => r.wait())
            .catch((e: Error) => { throw new Error(decodeRevertReason(e, false) as any) })
          expect(rcpt.events?.map(ev => ev.event)).to.eql([
            'BeforeExecution',
            'PostOpRevertReason',
            'UserOperationPrefundTooLow',
            'UserOperationEvent'])
          expect(await counter.counters(account.address)).to.eql(current, 'should revert account with prefund too low')
          const userOpEvent = rcpt.events?.find(e => e.event === 'UserOperationEvent') as UserOperationEventEvent
          const collected = (await ethers.provider.getBalance(beneficiary)).sub(beneficiaryBalance)
          expect(userOpEvent.args.actualGasCost).to.equal(collected)
          expect(userOpEvent.args.success).to.eql(false)
        })
      })

      it('account should pay for tx', async function () {
        const op = await fillSignAndPack({
          sender: account.address,
          callData: accountExecFromEntryPoint.data,
          verificationGasLimit: 1e6,
          callGasLimit: 1e6
        }, accountOwner, entryPoint)
        const beneficiaryAddress = createAddress()
        const countBefore = await counter.counters(account.address)
        // for estimateGas, must specify maxFeePerGas, otherwise our gas check fails
        console.log('  == est gas=', await entryPoint.estimateGas.handleOps([op], beneficiaryAddress, { maxFeePerGas: 1e9 }).then(tostr))

        // must specify at least on of maxFeePerGas, gasLimit
        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 1e7
        }).then(async t => await t.wait())

        const countAfter = await counter.counters(account.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)
        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)

        await calcGasUsage(rcpt, entryPoint, beneficiaryAddress)
      })

      it('account should pay for high gas usage tx', async function () {
        if (process.env.COVERAGE != null) {
          return
        }
        const iterations = 45
        const count = await counter.populateTransaction.gasWaster(iterations, '')
        const accountExec = await account.populateTransaction.execute(counter.address, 0, count.data!)
        const op = await fillSignAndPack({
          sender: account.address,
          callData: accountExec.data,
          verificationGasLimit: 1e5,
          callGasLimit: 11e5
        }, accountOwner, entryPoint)
        const beneficiaryAddress = createAddress()
        const offsetBefore = await counter.offset()
        console.log('  == offset before', offsetBefore)
        // for estimateGas, must specify maxFeePerGas, otherwise our gas check fails
        console.log('  == est gas=', await entryPoint.estimateGas.handleOps([op], beneficiaryAddress, { maxFeePerGas: 1e9 }).then(tostr))

        // must specify at least on of maxFeePerGas, gasLimit
        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 13e5
        }).then(async t => await t.wait())

        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)
        await calcGasUsage(rcpt, entryPoint, beneficiaryAddress)

        // check that the state of the counter contract is updated
        // this ensures that the `callGasLimit` is high enough
        // therefore this value can be used as a reference in the test below
        console.log('  == offset after', await counter.offset())
        expect(await counter.offset()).to.equal(offsetBefore.add(iterations))
      })

      it('account should not pay if too low gas limit was set', async function () {
        const iterations = 45
        const count = await counter.populateTransaction.gasWaster(iterations, '')
        const accountExec = await account.populateTransaction.execute(counter.address, 0, count.data!)
        const op = await fillSignAndPack({
          sender: account.address,
          callData: accountExec.data,
          verificationGasLimit: 1e5,
          callGasLimit: 11e5
        }, accountOwner, entryPoint)
        const inititalAccountBalance = await getBalance(account.address)
        const beneficiaryAddress = createAddress()
        const offsetBefore = await counter.offset()
        console.log('  == offset before', offsetBefore)
        // for estimateGas, must specify maxFeePerGas, otherwise our gas check fails
        console.log('  == est gas=', await entryPoint.estimateGas.handleOps([op], beneficiaryAddress, { maxFeePerGas: 1e9 }).then(tostr))

        // must specify at least on of maxFeePerGas, gasLimit
        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        // this transaction should revert as the gasLimit is too low to satisfy the expected `callGasLimit` (see test above)
        await expect(entryPoint.handleOps([op], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 12e5
        })).to.revertedWith('AA95 out of gas')

        // Make sure that the user did not pay for the transaction
        expect(await getBalance(account.address)).to.eq(inititalAccountBalance)
      })

      it('account should pay a penalty for requiring too much gas and leaving it unused', async function () {
        if (process.env.COVERAGE != null) {
          return
        }
        const iterations = 10
        const count = await counter.populateTransaction.gasWaster(iterations, '')
        const accountExec = await account.populateTransaction.execute(counter.address, 0, count.data!)
        const callGasLimit = await ethersSigner.provider.estimateGas({
          from: entryPoint.address,
          to: account.address,
          data: accountExec.data
        })
        // expect(callGasLimit.toNumber()).to.be.closeTo(270000, 10000)
        const beneficiaryAddress = createAddress()

        // "warmup" userop, for better gas calculation, below
        await entryPoint.handleOps([await fillSignAndPack({ sender: account.address, callData: accountExec.data }, accountOwner, entryPoint)], beneficiaryAddress)
        await entryPoint.handleOps([await fillSignAndPack({ sender: account.address, callData: accountExec.data }, accountOwner, entryPoint)], beneficiaryAddress)

        const op1 = await fillSignAndPack({
          sender: account.address,
          callData: accountExec.data,
          verificationGasLimit: 1e5,
          callGasLimit: callGasLimit
        }, accountOwner, entryPoint)

        const rcpt1 = await entryPoint.handleOps([op1], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 20000000
        }).then(async t => await t.wait())
        const logs1 = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt1.blockHash)
        expect(logs1[0].args.success).to.be.true

        const gasUsed1 = logs1[0].args.actualGasUsed.toNumber()
        const veryBigCallGasLimit = 10000000
        const op2 = await fillSignAndPack({
          sender: account.address,
          callData: accountExec.data,
          verificationGasLimit: 1e5,
          callGasLimit: veryBigCallGasLimit
        }, accountOwner, entryPoint)
        const rcpt2 = await entryPoint.handleOps([op2], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 20000000
        }).then(async t => await t.wait())
        const logs2 = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt2.blockHash)

        const gasUsed2 = logs2[0].args.actualGasUsed.toNumber()

        // we cannot access internal transaction state, so we have to rely on two separate transactions for estimation
        // assuming 10% penalty is charged
        const expectedGasPenalty = (veryBigCallGasLimit - callGasLimit.toNumber()) * 0.1
        const actualGasPenalty = gasUsed2 - gasUsed1

        console.log(actualGasPenalty / expectedGasPenalty)
        expect(actualGasPenalty).to.be.closeTo(expectedGasPenalty, expectedGasPenalty * 0.001)
      })

      it('legacy mode (maxPriorityFee==maxFeePerGas) should not use "basefee" opcode', async function () {
        const op = await fillSignAndPack({
          sender: account.address,
          callData: accountExecFromEntryPoint.data,
          maxPriorityFeePerGas: 10e9,
          maxFeePerGas: 10e9,
          verificationGasLimit: 1e6,
          callGasLimit: 1e6
        }, accountOwner, entryPoint)
        const beneficiaryAddress = createAddress()

        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 1e7
        }).then(async t => await t.wait())

        const ops = await debugTransaction(rcpt.transactionHash).then(tx => tx.structLogs.map(op => op.op))
        expect(ops).to.include('GAS')
        expect(ops).to.not.include('BASEFEE')
      })

      it('if account has a deposit, it should use it to pay', async function () {
        await account.addDeposit({ value: ONE_ETH })
        const op = await fillSignAndPack({
          sender: account.address,
          callData: accountExecFromEntryPoint.data,
          verificationGasLimit: 1e6,
          callGasLimit: 1e6
        }, accountOwner, entryPoint)
        const beneficiaryAddress = createAddress()

        const countBefore = await counter.counters(account.address)
        // for estimateGas, must specify maxFeePerGas, otherwise our gas check fails
        console.log('  == est gas=', await entryPoint.estimateGas.handleOps([op], beneficiaryAddress, { maxFeePerGas: 1e9 }).then(tostr))

        const balBefore = await getBalance(account.address)
        const depositBefore = await entryPoint.balanceOf(account.address)
        // must specify at least one of maxFeePerGas, gasLimit
        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 1e7
        }).then(async t => await t.wait())

        const countAfter = await counter.counters(account.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)
        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)

        const balAfter = await getBalance(account.address)
        const depositAfter = await entryPoint.balanceOf(account.address)
        expect(balAfter).to.equal(balBefore, 'should pay from stake, not balance')
        const depositUsed = depositBefore.sub(depositAfter)
        expect(await ethers.provider.getBalance(beneficiaryAddress)).to.equal(depositUsed)

        await calcGasUsage(rcpt, entryPoint, beneficiaryAddress)
      })

      it('should pay for reverted tx', async () => {
        const op = await fillSignAndPack({
          sender: account.address,
          callData: '0xdeadface',
          verificationGasLimit: 1e6,
          callGasLimit: 1e6
        }, accountOwner, entryPoint)
        const beneficiaryAddress = createAddress()

        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 1e7
        }).then(async t => await t.wait())

        const [log] = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt.blockHash)
        expect(log.args.success).to.eq(false)
        expect(await getBalance(beneficiaryAddress)).to.be.gte(1)
      })

      it('#handleOp (single)', async () => {
        const beneficiaryAddress = createAddress()

        const op = await fillSignAndPack({
          sender: account.address,
          callData: accountExecFromEntryPoint.data
        }, accountOwner, entryPoint)

        const countBefore = await counter.counters(account.address)
        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7
        }).then(async t => await t.wait())
        const countAfter = await counter.counters(account.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)

        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)
        await calcGasUsage(rcpt, entryPoint, beneficiaryAddress)
      })

      it('should fail to call recursively into handleOps', async () => {
        const beneficiaryAddress = createAddress()

        const callHandleOps = entryPoint.interface.encodeFunctionData('handleOps', [[], beneficiaryAddress])
        const execHandlePost = account.interface.encodeFunctionData('execute', [entryPoint.address, 0, callHandleOps])
        const op = await fillSignAndPack({
          sender: account.address,
          callData: execHandlePost
        }, accountOwner, entryPoint)

        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7
        }).then(async r => r.wait())

        const error = rcpt.events?.find(ev => ev.event === 'UserOperationRevertReason')
        // console.log(rcpt.events!.map(e => ({ ev: e.event, ...objdump(e.args!) })))

        expect(decodeRevertReason(error?.args?.revertReason)).to.eql('ReentrancyGuardReentrantCall()', 'execution of handleOps inside a UserOp should revert')
      })
      it('should report failure on insufficient verificationGas after creation', async () => {
        const op0 = await fillSignAndPack({
          sender: account.address,
          verificationGasLimit: 5e5
        }, accountOwner, entryPoint)
        // must succeed with enough verification gas
        await simulateValidation(op0, entryPoint.address)

        const op1 = await fillSignAndPack({
          sender: account.address,
          verificationGasLimit: 10000
        }, accountOwner, entryPoint)
        await expect(simulateValidation(op1, entryPoint.address))
          .to.revertedWith('AA23 reverted')
      })
    })

    describe('create account', () => {
      let createOp: PackedUserOperation
      const beneficiaryAddress = createAddress() // 1

      it('should reject create if sender address is wrong', async () => {
        const op = await fillSignAndPack({
          initCode: getAccountInitCode(accountOwner.address, simpleAccountFactory),
          verificationGasLimit: 2e6,
          sender: '0x'.padEnd(42, '1')
        }, accountOwner, entryPoint)

        await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7
        })).to.revertedWith('AA14 initCode must return sender')
      })

      it('should reject create if account not funded', async () => {
        const op = await fillSignAndPack({
          initCode: getAccountInitCode(accountOwner.address, simpleAccountFactory, 100),
          verificationGasLimit: 2e6
        }, accountOwner, entryPoint)

        expect(await ethers.provider.getBalance(op.sender)).to.eq(0)

        await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7,
          gasPrice: await ethers.provider.getGasPrice()
        })).to.revertedWith('didn\'t pay prefund')

        // await expect(await ethers.provider.getCode(op.sender).then(x => x.length)).to.equal(2, "account exists before creation")
      })

      it('should succeed to create account after prefund', async () => {
        const salt = 20
        const preAddr = await getAccountAddress(accountOwner.address, simpleAccountFactory, salt)
        await fund(preAddr)
        createOp = await fillSignAndPack({
          initCode: getAccountInitCode(accountOwner.address, simpleAccountFactory, salt),
          callGasLimit: 1e6,
          verificationGasLimit: 2e6

        }, accountOwner, entryPoint)

        await expect(await ethers.provider.getCode(preAddr).then(x => x.length)).to.equal(2, 'account exists before creation')
        const ret = await entryPoint.handleOps([createOp], beneficiaryAddress, {
          gasLimit: 1e7
        })
        const rcpt = await ret.wait()
        const hash = await entryPoint.getUserOpHash(createOp)
        await expect(ret).to.emit(entryPoint, 'AccountDeployed')
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
          .withArgs(hash, createOp.sender, toChecksumAddress(createOp.initCode.toString().slice(0, 42)), AddressZero)

        await calcGasUsage(rcpt!, entryPoint, beneficiaryAddress)
      })

      it('should reject if account already created', async function () {
        const preAddr = await getAccountAddress(accountOwner.address, simpleAccountFactory)
        if (await ethers.provider.getCode(preAddr).then(x => x.length) === 2) {
          this.skip()
        }

        await expect(entryPoint.callStatic.handleOps([createOp], beneficiaryAddress, {
          gasLimit: 1e7
        })).to.revertedWith('sender already constructed')
      })
    })

    describe('batch multiple requests', function () {
      this.timeout(20000)
      if (process.env.COVERAGE != null) {
        return
      }
      /**
             * attempt a batch:
             * 1. create account1 + "initialize" (by calling counter.count())
             * 2. account2.exec(counter.count()
             *    (account created in advance)
             */
      let counter: TestCounter
      let accountExecCounterFromEntryPoint: PopulatedTransaction
      const beneficiaryAddress = createAddress()
      const accountOwner1 = createAccountOwner()
      let account1: string
      const accountOwner2 = createAccountOwner()
      let account2: SimpleAccount

      before('before', async () => {
        counter = await new TestCounter__factory(ethersSigner).deploy()
        const count = await counter.populateTransaction.count()
        accountExecCounterFromEntryPoint = await account.populateTransaction.execute(counter.address, 0, count.data!)
        account1 = await getAccountAddress(accountOwner1.address, simpleAccountFactory);
        ({ proxy: account2 } = await createAccount(ethersSigner, await accountOwner2.getAddress(), entryPoint.address))
        await fund(account1)
        await fund(account2.address)
        // execute and increment counter
        const op1 = await fillSignAndPack({
          initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory),
          callData: accountExecCounterFromEntryPoint.data,
          callGasLimit: 2e6,
          verificationGasLimit: 2e6
        }, accountOwner1, entryPoint)

        const op2 = await fillSignAndPack({
          callData: accountExecCounterFromEntryPoint.data,
          sender: account2.address,
          callGasLimit: 2e6,
          verificationGasLimit: 76000
        }, accountOwner2, entryPoint)

        await simulateValidation(op2, entryPoint.address)

        await fund(op1.sender)
        await fund(account2.address)
        await entryPoint.handleOps([op1!, op2], beneficiaryAddress).catch((rethrow())).then(async r => r!.wait())
        // console.log(ret.events!.map(e=>({ev:e.event, ...objdump(e.args!)})))
      })
      it('should execute', async () => {
        expect(await counter.counters(account1)).equal(1)
        expect(await counter.counters(account2.address)).equal(1)
      })
      it('should pay for tx', async () => {
        // const cost1 = prebalance1.sub(await ethers.provider.getBalance(account1))
        // const cost2 = prebalance2.sub(await ethers.provider.getBalance(account2.address))
        // console.log('cost1=', cost1)
        // console.log('cost2=', cost2)
      })
    })

    describe('aggregation tests', () => {
      const beneficiaryAddress = createAddress()
      let aggregator: TestSignatureAggregator
      let aggAccount: TestAggregatedAccount
      let aggAccount2: TestAggregatedAccount

      before(async () => {
        aggregator = await new TestSignatureAggregator__factory(ethersSigner).deploy()
        aggAccount = await new TestAggregatedAccount__factory(ethersSigner).deploy(entryPoint.address, aggregator.address)
        aggAccount2 = await new TestAggregatedAccount__factory(ethersSigner).deploy(entryPoint.address, aggregator.address)
        await ethersSigner.sendTransaction({ to: aggAccount.address, value: parseEther('0.1') })
        await ethersSigner.sendTransaction({ to: aggAccount2.address, value: parseEther('0.1') })
      })
      it('should fail to execute aggregated account without an aggregator', async () => {
        const userOp = await fillSignAndPack({
          sender: aggAccount.address
        }, accountOwner, entryPoint)

        // no aggregator is kind of "wrong aggregator"
        await expect(entryPoint.handleOps([userOp], beneficiaryAddress)).to.revertedWith('AA24 signature error')
      })
      it('should fail to execute aggregated account with wrong aggregator', async () => {
        const userOp = await fillSignAndPack({
          sender: aggAccount.address
        }, accountOwner, entryPoint)

        const wrongAggregator = await new TestSignatureAggregator__factory(ethersSigner).deploy()
        const sig = HashZero

        await expect(entryPoint.handleAggregatedOps([{
          userOps: [userOp],
          aggregator: wrongAggregator.address,
          signature: sig
        }], beneficiaryAddress)).to.revertedWith('AA24 signature error')
      })

      it('should reject non-contract (address(1)) aggregator', async () => {
        // this is just sanity check that the compiler indeed reverts on a call to "validateSignatures()" to nonexistent contracts
        const address1 = hexZeroPad('0x1', 20)
        const aggAccount1 = await new TestAggregatedAccount__factory(ethersSigner).deploy(entryPoint.address, address1)

        const userOp = await fillSignAndPack({
          sender: aggAccount1.address,
          maxFeePerGas: 0
        }, accountOwner, entryPoint)

        const sig = HashZero

        expect(await entryPoint.handleAggregatedOps([{
          userOps: [userOp],
          aggregator: address1,
          signature: sig
        }], beneficiaryAddress).catch(e => e.reason))
          .to.match(/invalid aggregator/)
        // (different error in coverage mode (because of different solidity settings)
      })

      it('should fail to execute aggregated account with wrong agg. signature', async () => {
        const userOp = await fillSignAndPack({
          sender: aggAccount.address
        }, accountOwner, entryPoint)

        const wrongSig = hexZeroPad('0x123456', 32)
        const aggAddress: string = aggregator.address
        await expect(
          entryPoint.handleAggregatedOps([{
            userOps: [userOp],
            aggregator: aggregator.address,
            signature: wrongSig
          }], beneficiaryAddress)).to.revertedWith(`SignatureValidationFailed("${aggAddress}")`)
      })

      it('should run with multiple aggregators (and non-aggregated-accounts)', async () => {
        const aggregator3 = await new TestSignatureAggregator__factory(ethersSigner).deploy()
        const aggAccount3 = await new TestAggregatedAccount__factory(ethersSigner).deploy(entryPoint.address, aggregator3.address)
        await ethersSigner.sendTransaction({ to: aggAccount3.address, value: parseEther('0.1') })

        const userOp1 = await fillSignAndPack({
          sender: aggAccount.address
        }, accountOwner, entryPoint)
        const userOp2 = await fillSignAndPack({
          sender: aggAccount2.address
        }, accountOwner, entryPoint)
        const userOp_agg3 = await fillSignAndPack({
          sender: aggAccount3.address
        }, accountOwner, entryPoint)
        const userOp_noAgg = await fillSignAndPack({
          sender: account.address
        }, accountOwner, entryPoint)

        // extract signature from userOps, and create aggregated signature
        // (not really required with the test aggregator, but should work with any aggregator
        const sigOp1 = await aggregator.validateUserOpSignature(userOp1)
        const sigOp2 = await aggregator.validateUserOpSignature(userOp2)
        userOp1.signature = sigOp1
        userOp2.signature = sigOp2
        const aggSig = await aggregator.aggregateSignatures([userOp1, userOp2])

        const aggInfos = [{
          userOps: [userOp1, userOp2],
          aggregator: aggregator.address,
          signature: aggSig
        }, {
          userOps: [userOp_agg3],
          aggregator: aggregator3.address,
          signature: HashZero
        }, {
          userOps: [userOp_noAgg],
          aggregator: AddressZero,
          signature: '0x'
        }]
        const rcpt = await entryPoint.handleAggregatedOps(aggInfos, beneficiaryAddress, { gasLimit: 3e6 }).then(async ret => ret.wait())
        const events = rcpt.events?.map((ev: Event) => {
          if (ev.event === 'UserOperationEvent') {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            return `userOp(${ev.args?.sender})`
          }
          if (ev.event === 'SignatureAggregatorChanged') {
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            return `agg(${ev.args?.aggregator})`
          } else return null
        }).filter(ev => ev != null)
        // expected "SignatureAggregatorChanged" before every switch of aggregator
        expect(events).to.eql([
                    `agg(${aggregator.address})`,
                    `userOp(${userOp1.sender})`,
                    `userOp(${userOp2.sender})`,
                    `agg(${aggregator3.address})`,
                    `userOp(${userOp_agg3.sender})`,
                    `agg(${AddressZero})`,
                    `userOp(${userOp_noAgg.sender})`,
                    `agg(${AddressZero})`
        ])
      })

      describe('execution ordering', () => {
        let userOp1: UserOperation
        let userOp2: UserOperation
        before(async () => {
          userOp1 = await fillAndSign({
            sender: aggAccount.address
          }, accountOwner, entryPoint)
          userOp2 = await fillAndSign({
            sender: aggAccount2.address
          }, accountOwner, entryPoint)
          userOp1.signature = '0x'
          userOp2.signature = '0x'
        })

        context('create account', () => {
          let initCode: BytesLike
          let addr: string
          let userOp: PackedUserOperation
          before(async () => {
            const factory = await new TestAggregatedAccountFactory__factory(ethersSigner).deploy(entryPoint.address, aggregator.address)
            initCode = await getAggregatedAccountInitCode(factory)
            addr = await entryPoint.callStatic.getSenderAddress(initCode).catch(e => e.errorArgs.sender)
            await ethersSigner.sendTransaction({ to: addr, value: parseEther('0.1') })
            userOp = await fillSignAndPack({
              initCode
            }, accountOwner, entryPoint)
          })
          it('simulateValidation should return aggregator and its stake', async () => {
            await aggregator.addStake(entryPoint.address, 3, { value: TWO_ETH })
            const { aggregatorInfo } = await simulateValidation(userOp, entryPoint.address)
            expect(aggregatorInfo.aggregator).to.equal(aggregator.address)
            expect(aggregatorInfo.stakeInfo.stake).to.equal(TWO_ETH)
            expect(aggregatorInfo.stakeInfo.unstakeDelaySec).to.equal(3)
          })
          it('should create account in handleOps', async () => {
            await aggregator.validateUserOpSignature(userOp)
            const sig = await aggregator.aggregateSignatures([userOp])
            await entryPoint.handleAggregatedOps([{
              userOps: [{ ...userOp, signature: '0x' }],
              aggregator: aggregator.address,
              signature: sig
            }], beneficiaryAddress, { gasLimit: 3e6 })
          })
        })
      })
    })

    describe('with paymaster (account with no eth)', () => {
      let paymaster: TestPaymasterAcceptAll
      let counter: TestCounter
      let accountExecFromEntryPoint: PopulatedTransaction
      const account2Owner = createAccountOwner()

      before(async () => {
        paymaster = await new TestPaymasterAcceptAll__factory(ethersSigner).deploy(entryPoint.address)
        await paymaster.addStake(globalUnstakeDelaySec, { value: paymasterStake })
        counter = await new TestCounter__factory(ethersSigner).deploy()
        const count = await counter.populateTransaction.count()
        accountExecFromEntryPoint = await account.populateTransaction.execute(counter.address, 0, count.data!)
      })

      it('should fail with nonexistent paymaster', async () => {
        const pm = createAddress()
        const op = await fillSignAndPack({
          paymaster: pm,
          paymasterVerificationGasLimit: 3e6,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(account2Owner.address, simpleAccountFactory),
          verificationGasLimit: 3e6,
          callGasLimit: 1e6
        }, account2Owner, entryPoint)
        await expect(simulateValidation(op, entryPoint.address)).to.revertedWith('"AA30 paymaster not deployed"')
      })

      it('should fail if paymaster has no deposit', async function () {
        const op = await fillSignAndPack({
          paymaster: paymaster.address,
          paymasterVerificationGasLimit: 3e6,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(account2Owner.address, simpleAccountFactory),

          verificationGasLimit: 3e6,
          callGasLimit: 1e6
        }, account2Owner, entryPoint)
        const beneficiaryAddress = createAddress()
        await expect(entryPoint.handleOps([op], beneficiaryAddress)).to.revertedWith('"AA31 paymaster deposit too low"')
      })

      it('should not revert when paymaster reverts with custom error on postOp', async function () {
        const account3Owner = createAccountOwner()
        const errorPostOp = await new TestPaymasterRevertCustomError__factory(ethersSigner).deploy(entryPoint.address)
        await errorPostOp.setRevertType(0)
        await errorPostOp.addStake(globalUnstakeDelaySec, { value: paymasterStake })
        await errorPostOp.deposit({ value: ONE_ETH })

        const op = await fillSignAndPack({
          paymaster: errorPostOp.address,
          paymasterPostOpGasLimit: 1e5,
          paymasterVerificationGasLimit: 3e6,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(account3Owner.address, simpleAccountFactory),

          verificationGasLimit: 3e6,
          callGasLimit: 1e6
        }, account3Owner, entryPoint)
        const beneficiaryAddress = createAddress()
        const rcpt1 = await entryPoint.handleOps([op], beneficiaryAddress).then(async t => await t.wait())
        const logs1 = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt1.blockHash)
        const logs1postOpRevert = await entryPoint.queryFilter(entryPoint.filters.PostOpRevertReason(), rcpt1.blockHash)
        const postOpRevertReason = decodeRevertReason(logs1postOpRevert[0].args.revertReason, false)
        expect(logs1[0].args.success).to.be.false
        expect(postOpRevertReason).to.equal('PostOpReverted(CustomError("this is a long revert reason string we are looking for"))')
      })

      it('should not revert when paymaster reverts with known EntryPoint error in postOp', async function () {
        const account3Owner = createAccountOwner()
        const errorPostOp = await new TestPaymasterRevertCustomError__factory(ethersSigner).deploy(entryPoint.address)
        await errorPostOp.setRevertType(1)
        await errorPostOp.addStake(globalUnstakeDelaySec, { value: paymasterStake })
        await errorPostOp.deposit({ value: ONE_ETH })

        const op = await fillSignAndPack({
          paymaster: errorPostOp.address,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(account3Owner.address, simpleAccountFactory),

          verificationGasLimit: 3e6,
          callGasLimit: 1e6
        }, account3Owner, entryPoint)
        const beneficiaryAddress = createAddress()
        const rcpt1 = await entryPoint.handleOps([op], beneficiaryAddress).then(async t => await t.wait())
        const logs1 = await entryPoint.queryFilter(entryPoint.filters.UserOperationEvent(), rcpt1.blockHash)
        expect(logs1[0].args.success).to.be.false
      })

      it('paymaster should pay for tx', async function () {
        await paymaster.deposit({ value: ONE_ETH })
        const op = await fillSignAndPack({
          paymaster: paymaster.address,
          paymasterVerificationGasLimit: 1e6,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(account2Owner.address, simpleAccountFactory)
        }, account2Owner, entryPoint)
        const beneficiaryAddress = createAddress()

        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress).then(async t => t.wait())

        const { actualGasCost } = await calcGasUsage(rcpt, entryPoint, beneficiaryAddress)
        const paymasterPaid = ONE_ETH.sub(await entryPoint.balanceOf(paymaster.address))
        expect(paymasterPaid).to.eql(actualGasCost)
      })
      it('simulateValidation should return paymaster stake and delay', async () => {
        await paymaster.deposit({ value: ONE_ETH })
        const anOwner = createAccountOwner()

        const op = await fillSignAndPack({
          paymaster: paymaster.address,
          paymasterVerificationGasLimit: 1e6,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(anOwner.address, simpleAccountFactory)
        }, anOwner, entryPoint)

        const { paymasterInfo } = await simulateValidation(op, entryPoint.address)
        const {
          stake: simRetStake,
          unstakeDelaySec: simRetDelay
        } = paymasterInfo

        expect(simRetStake).to.eql(paymasterStake)
        expect(simRetDelay).to.eql(globalUnstakeDelaySec)
      })
    })

    describe('Validation time-range', () => {
      const beneficiary = createAddress()
      let account: TestExpiryAccount
      let now: number
      let sessionOwner: Wallet
      before('init account with session key', async () => {
        // create a test account. The primary owner is the global ethersSigner, so that we can easily add a temporaryOwner, below
        account = await new TestExpiryAccount__factory(ethersSigner).deploy(entryPoint.address)
        await account.initialize(await ethersSigner.getAddress())
        await ethersSigner.sendTransaction({ to: account.address, value: parseEther('0.1') })
        now = await ethers.provider.getBlock('latest').then(block => block.timestamp)
        sessionOwner = createAccountOwner()
        await account.addTemporaryOwner(sessionOwner.address, 100, now + 60)
      })

      describe('validateUserOp time-range', function () {
        it('should accept non-expired owner', async () => {
          const userOp = await fillSignAndPack({
            sender: account.address
          }, sessionOwner, entryPoint)
          const ret = await simulateValidation(userOp, entryPoint.address)
          const validationData = parseValidationData(ret.returnInfo.accountValidationData)
          expect(validationData.validUntil).to.eql(now + 60)
          expect(validationData.validAfter).to.eql(100)
        })

        it('should not reject expired owner', async () => {
          const expiredOwner = createAccountOwner()
          await account.addTemporaryOwner(expiredOwner.address, 123, now - 60)
          const userOp = await fillSignAndPack({
            sender: account.address
          }, expiredOwner, entryPoint)
          const ret = await simulateValidation(userOp, entryPoint.address)
          console.log(ret.returnInfo.accountValidationData.toHexString())
          const validationData = parseValidationData(ret.returnInfo.accountValidationData)
          console.log('validationdata=', validationData)
          expect(validationData.validUntil).eql(now - 60)
          expect(validationData.validAfter).to.eql(123)
        })
      })

      describe('validatePaymasterUserOp with deadline', function () {
        let paymaster: TestExpirePaymaster
        let now: number
        before('init account with session key', async function () {
          this.timeout(20000)
          paymaster = await new TestExpirePaymaster__factory(ethersSigner).deploy(entryPoint.address)
          await paymaster.addStake(1, { value: paymasterStake })
          await paymaster.deposit({ value: parseEther('0.1') })
          now = await ethers.provider.getBlock('latest').then(block => block.timestamp)
        })

        it('should accept non-expired paymaster request', async () => {
          const timeRange = defaultAbiCoder.encode(['uint48', 'uint48'], [123, now + 60])
          const userOp = await fillSignAndPack({
            sender: account.address,
            paymaster: paymaster.address,
            paymasterData: timeRange
          }, ethersSigner, entryPoint)
          const ret = await simulateValidation(userOp, entryPoint.address)
          const { validUntil, validAfter } = parseValidationData(ret.returnInfo.paymasterValidationData)
          expect(validUntil).to.eql(now + 60)
          expect(validAfter).to.eql(123)
        })

        it('should not reject expired paymaster request', async () => {
          const timeRange = defaultAbiCoder.encode(['uint48', 'uint48'], [321, now - 60])
          const userOp = await fillSignAndPack({
            sender: account.address,
            paymaster: paymaster.address,
            paymasterData: timeRange
          }, ethersSigner, entryPoint)
          const ret = await simulateValidation(userOp, entryPoint.address)
          const { validUntil, validAfter } = parseValidationData(ret.returnInfo.paymasterValidationData)
          expect(validUntil).to.eql(now - 60)
          expect(validAfter).to.eql(321)
        })
      })
      describe('handleOps should abort on time-range', () => {
        it('should revert on expired account', async () => {
          const expiredOwner = createAccountOwner()
          await account.addTemporaryOwner(expiredOwner.address, 1, 2)
          const userOp = await fillSignAndPack({
            sender: account.address
          }, expiredOwner, entryPoint)
          await expect(entryPoint.handleOps([userOp], beneficiary))
            .to.revertedWith('AA22 expired or not due')
        })

        it('should revert on date owner', async () => {
          const futureOwner = createAccountOwner()
          await account.addTemporaryOwner(futureOwner.address, now + 100, now + 200)
          const userOp = await fillSignAndPack({
            sender: account.address
          }, futureOwner, entryPoint)
          await expect(entryPoint.handleOps([userOp], beneficiary))
            .to.revertedWith('AA22 expired or not due')
        })
      })
    })
  })

  describe('ERC-165', function () {
    it('should return true for IEntryPoint interface ID', async function () {
      const iepInterface = IEntryPoint__factory.createInterface()
      const iepInterfaceID = getERC165InterfaceID([...iepInterface.fragments])
      expect(await entryPoint.supportsInterface(iepInterfaceID)).to.equal(true)
    })

    it('should return true for pure EntryPoint, IStakeManager and INonceManager interface IDs', async function () {
      const epInterface = IEntryPoint__factory.createInterface()
      const smInterface = IStakeManager__factory.createInterface()
      const nmInterface = INonceManager__factory.createInterface()
      // note: manually generating "pure", solidity-like "type(IEntryPoint).interfaceId" without inherited methods
      const inheritedMethods = new Set([...smInterface.fragments, ...nmInterface.fragments].map(f => f.name))
      const epPureInterfaceFunctions = [
        ...epInterface.fragments.filter(it => !inheritedMethods.has(it.name) && it.type === 'function')
      ]
      const epPureInterfaceID = getERC165InterfaceID(epPureInterfaceFunctions)
      const smInterfaceID = getERC165InterfaceID([...smInterface.fragments])
      const nmInterfaceID = getERC165InterfaceID([...nmInterface.fragments])
      expect(await entryPoint.supportsInterface(smInterfaceID)).to.equal(true)
      expect(await entryPoint.supportsInterface(nmInterfaceID)).to.equal(true)
      expect(await entryPoint.supportsInterface(epPureInterfaceID)).to.equal(true)
    })

    it('should return false for a wrong interface', async function () {
      const saInterface = SimpleAccountFactory__factory.createInterface()
      const entryPointInterfaceID = getERC165InterfaceID([...saInterface.fragments])
      expect(await entryPoint.supportsInterface(entryPointInterfaceID)).to.equal(false)
    })
  })
})
