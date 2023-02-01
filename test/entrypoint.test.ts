import './aa.init'
import { BigNumber, Event, Wallet } from 'ethers'
import { expect } from 'chai'
import {
  EntryPoint,
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
  TestWarmColdAccount__factory
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
  checkForBannedOps,
  ONE_ETH,
  TWO_ETH,
  deployEntryPoint,
  getBalance,
  createAddress,
  getAccountAddress,
  HashZero,
  simulationResultCatch,
  createAccount,
  getAggregatedAccountInitCode,
  simulationResultWithAggregationCatch
} from './testutils'
import { DefaultsForUserOp, fillAndSign, getUserOpHash } from './UserOp'
import { UserOperation } from './UserOperation'
import { PopulatedTransaction } from 'ethers/lib/ethers'
import { ethers } from 'hardhat'
import { arrayify, defaultAbiCoder, hexConcat, hexZeroPad, parseEther } from 'ethers/lib/utils'
import { debugTransaction } from './debugTx'
import { BytesLike } from '@ethersproject/bytes'
import { toChecksumAddress, zeroAddress } from 'ethereumjs-util'

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
    expect(getUserOpHash(sampleOp, entryPoint.address, chainId)).to.eql(await entryPoint.getUserOpHash(sampleOp))
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
        await expect(entryPoint.addStake(0, { value: ONE_ETH })).to.revertedWith('must specify unstake delay')
      })
      it('should fail to unlock', async () => {
        await expect(entryPoint.unlockStake()).to.revertedWith('not staked')
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
          await expect(entryPoint.unlockStake()).to.revertedWith('already unstaking')
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
            await expect(entryPoint.unlockStake()).to.revertedWith('already unstaking')
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
    let account1: SimpleAccount

    before(async () => {
      ({ proxy: account1 } = await createAccount(ethersSigner, await accountOwner1.getAddress(), entryPoint.address))
    })

    it('should fail if validateUserOp fails', async () => {
      // using wrong nonce
      const op = await fillAndSign({ sender: account.address, nonce: 1234 }, accountOwner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(op).catch(rethrow())).to
        .revertedWith('invalid nonce')
    })

    it('should report signature failure without revert', async () => {
      // (this is actually a feature of the wallet, not the entrypoint)
      // using wrong owner for account1
      // (zero gas price so it doesn't fail on prefund)
      const op = await fillAndSign({ sender: account1.address, maxFeePerGas: 0 }, accountOwner, entryPoint)
      const { returnInfo } = await entryPoint.callStatic.simulateValidation(op).catch(simulationResultCatch)
      expect(returnInfo.sigFailed).to.be.true
    })

    it('should revert if wallet not deployed (and no initcode)', async () => {
      const op = await fillAndSign({
        sender: createAddress(),
        nonce: 0,
        verificationGasLimit: 1000
      }, accountOwner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(op)).to
        .revertedWith('AA20 account not deployed')
    })

    it('should revert on oog if not enough verificationGas', async () => {
      const op = await fillAndSign({ sender: account.address, verificationGasLimit: 1000 }, accountOwner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(op)).to
        .revertedWith('AA23 reverted (or OOG)')
    })

    it('should succeed if validateUserOp succeeds', async () => {
      const op = await fillAndSign({ sender: account1.address }, accountOwner1, entryPoint)
      await fund(account1)
      await entryPoint.callStatic.simulateValidation(op).catch(simulationResultCatch)
    })

    it('should return empty context if no paymaster', async () => {
      const op = await fillAndSign({ sender: account1.address, maxFeePerGas: 0 }, accountOwner1, entryPoint)
      const { returnInfo } = await entryPoint.callStatic.simulateValidation(op).catch(simulationResultCatch)
      expect(returnInfo.paymasterContext).to.eql('0x')
    })

    it('should return stake of sender', async () => {
      const stakeValue = BigNumber.from(123)
      const unstakeDelay = 3
      const { proxy: account2 } = await createAccount(ethersSigner, await ethersSigner.getAddress(), entryPoint.address)
      await fund(account2)
      await account2.execute(entryPoint.address, stakeValue, entryPoint.interface.encodeFunctionData('addStake', [unstakeDelay]))
      const op = await fillAndSign({ sender: account2.address }, ethersSigner, entryPoint)
      const result = await entryPoint.callStatic.simulateValidation(op).catch(simulationResultCatch)
      expect(result.senderInfo).to.eql({ stake: stakeValue, unstakeDelaySec: unstakeDelay })
    })

    it('should prevent overflows: fail if any numeric value is more than 120 bits', async () => {
      const op = await fillAndSign({
        preVerificationGas: BigNumber.from(2).pow(130),
        sender: account1.address
      }, accountOwner1, entryPoint)
      await expect(
        entryPoint.callStatic.simulateValidation(op)
      ).to.revertedWith('gas values overflow')
    })

    it('should fail creation for wrong sender', async () => {
      const op1 = await fillAndSign({
        initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory),
        sender: '0x'.padEnd(42, '1'),
        verificationGasLimit: 3e6
      }, accountOwner1, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(op1))
        .to.revertedWith('AA14 initCode must return sender')
    })

    it('should report failure on insufficient verificationGas (OOG) for creation', async () => {
      const initCode = getAccountInitCode(accountOwner1.address, simpleAccountFactory)
      const sender = await entryPoint.callStatic.getSenderAddress(initCode).catch(e => e.errorArgs.sender)
      const op0 = await fillAndSign({
        initCode,
        sender,
        verificationGasLimit: 5e5,
        maxFeePerGas: 0
      }, accountOwner1, entryPoint)
      // must succeed with enough verification gas.
      await expect(entryPoint.callStatic.simulateValidation(op0, { gasLimit: 1e6 }))
        .to.revertedWith('ValidationResult')

      const op1 = await fillAndSign({
        initCode,
        sender,
        verificationGasLimit: 1e5,
        maxFeePerGas: 0
      }, accountOwner1, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(op1, { gasLimit: 1e6 }))
        .to.revertedWith('AA13 initCode failed or OOG')
    })

    it('should succeed for creating an account', async () => {
      const sender = await getAccountAddress(accountOwner1.address, simpleAccountFactory)
      const op1 = await fillAndSign({
        sender,
        initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory)
      }, accountOwner1, entryPoint)
      await fund(op1.sender)

      await entryPoint.callStatic.simulateValidation(op1).catch(simulationResultCatch)
    })

    it('should not call initCode from entrypoint', async () => {
      // a possible attack: call an account's execFromEntryPoint through initCode. This might lead to stolen funds.
      const { proxy: account } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address)
      const sender = createAddress()
      const op1 = await fillAndSign({
        initCode: hexConcat([
          account.address,
          account.interface.encodeFunctionData('execute', [sender, 0, '0x'])
        ]),
        sender
      }, accountOwner, entryPoint)
      const error = await entryPoint.callStatic.simulateValidation(op1).catch(e => e)
      expect(error.message).to.match(/initCode failed or OOG/, error)
    })

    it('should not use banned ops during simulateValidation', async () => {
      const op1 = await fillAndSign({
        initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory),
        sender: await getAccountAddress(accountOwner1.address, simpleAccountFactory)
      }, accountOwner1, entryPoint)
      await fund(op1.sender)
      await entryPoint.simulateValidation(op1, { gasLimit: 10e6 }).catch(e => e)
      const block = await ethers.provider.getBlock('latest')
      const hash = block.transactions[0]
      await checkForBannedOps(hash, false)
    })
  })

  describe('#simulateHandleOp', () => {
    it('should simulate execution', async () => {
      const accountOwner1 = createAccountOwner()
      const { proxy: account } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address)
      await fund(account)
      const counter = await new TestCounter__factory(ethersSigner).deploy()

      const count = counter.interface.encodeFunctionData('count')
      const callData = account.interface.encodeFunctionData('execute', [counter.address, 0, count])
      // deliberately broken signature.. simulate should work with it too.
      const userOp = await fillAndSign({
        sender: account.address,
        callData
      }, accountOwner1, entryPoint)

      const ret = await entryPoint.callStatic.simulateHandleOp(userOp,
        counter.address,
        counter.interface.encodeFunctionData('counters', [account.address])
      ).catch(e => e.errorArgs)

      const [countResult] = counter.interface.decodeFunctionResult('counters', ret.targetResult)
      expect(countResult).to.eql(1)
      expect(ret.targetSuccess).to.be.true

      // actual counter is zero
      expect(await counter.counters(account.address)).to.eql(0)
    })
  })

  describe('flickering account validation', () => {
    it('should prevent leakage of basefee', async () => {
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
        nonce: block.baseFeePerGas,
        initCode: '0x',
        callData: '0x',
        callGasLimit: '0x' + 1e5.toString(16),
        verificationGasLimit: '0x' + 1e5.toString(16),
        preVerificationGas: '0x' + 1e5.toString(16),
        // we need maxFeeperGas > block.basefee + maxPriorityFeePerGas so requiredPrefund onchain is basefee + maxPriorityFeePerGas
        maxFeePerGas: block.baseFeePerGas.mul(3),
        maxPriorityFeePerGas: block.baseFeePerGas,
        paymasterAndData: '0x',
        signature: '0x'
      }
      try {
        await expect(entryPoint.simulateValidation(userOp, { gasLimit: 1e6 }))
          .to.revertedWith('ValidationResult')
        console.log('after first simulation')
        await ethers.provider.send('evm_mine', [])
        await expect(entryPoint.simulateValidation(userOp, { gasLimit: 1e6 }))
          .to.revertedWith('Revert after first validation')
        // if we get here, it means the userOp passed first sim and reverted second
        expect.fail(null, null, 'should fail on first simulation')
      } catch (e: any) {
        expect(e.message).to.include('Revert after first validation')
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
        verificationGasLimit: 1e5,
        callData: badData.data!
      }
      const beneficiaryAddress = createAddress()
      await expect(entryPoint.simulateValidation(badOp, { gasLimit: 3e5 }))
        .to.revertedWith('ValidationResult')
      const tx = await entryPoint.handleOps([badOp], beneficiaryAddress, { gasLimit: 3e5 })
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
        const beneficiaryAddress = createAddress()
        try {
          await entryPoint.simulateValidation(badOp, { gasLimit: 1e6 })
        } catch (e: any) {
          if ((e as Error).message.includes('ValidationResult')) {
            const tx = await entryPoint.handleOps([badOp], beneficiaryAddress, { gasLimit: 1e6 })
            await tx.wait()
          } else {
            expect(e.message).to.include('FailedOp(0, "0x0000000000000000000000000000000000000000", "AA23 reverted (or OOG)")')
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
          paymasterAndData: paymaster.address,
          sender: testWarmColdAccount.address
        }
        const beneficiaryAddress = createAddress()
        try {
          await entryPoint.simulateValidation(badOp, { gasLimit: 1e6 })
        } catch (e: any) {
          if ((e as Error).message.includes('ValidationResult')) {
            const tx = await entryPoint.handleOps([badOp], beneficiaryAddress, { gasLimit: 1e6 })
            await tx.wait()
          } else {
            expect(e.message).to.include('FailedOp(0, "0x0000000000000000000000000000000000000000", "AA23 reverted (or OOG)")')
          }
        }
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
        const op = await fillAndSign({
          sender: account.address
        }, wrongOwner, entryPoint)
        const beneficiaryAddress = createAddress()
        await expect(entryPoint.estimateGas.handleOps([op], beneficiaryAddress)).to.revertedWith('AA24 signature error')
      })

      it('account should pay for tx', async function () {
        const op = await fillAndSign({
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
        const op = await fillAndSign({
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
        const op = await fillAndSign({
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

      it('legacy mode (maxPriorityFee==maxFeePerGas) should not use "basefee" opcode', async function () {
        const op = await fillAndSign({
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
        const op = await fillAndSign({
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
        const op = await fillAndSign({
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

        const op = await fillAndSign({
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

      it('should report failure on insufficient verificationGas after creation', async () => {
        const op0 = await fillAndSign({
          sender: account.address,
          verificationGasLimit: 5e5
        }, accountOwner, entryPoint)
        // must succeed with enough verification gas
        await expect(entryPoint.callStatic.simulateValidation(op0))
          .to.revertedWith('ValidationResult')

        const op1 = await fillAndSign({
          sender: account.address,
          verificationGasLimit: 10000
        }, accountOwner, entryPoint)
        await expect(entryPoint.callStatic.simulateValidation(op1))
          .to.revertedWith('AA23 reverted (or OOG)')
      })
    })

    describe('create account', () => {
      if (process.env.COVERAGE != null) {
        return
      }
      let createOp: UserOperation
      const beneficiaryAddress = createAddress() // 1

      it('should reject create if sender address is wrong', async () => {
        const op = await fillAndSign({
          initCode: getAccountInitCode(accountOwner.address, simpleAccountFactory),
          verificationGasLimit: 2e6,
          sender: '0x'.padEnd(42, '1')
        }, accountOwner, entryPoint)

        await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7
        })).to.revertedWith('AA14 initCode must return sender')
      })

      it('should reject create if account not funded', async () => {
        const op = await fillAndSign({
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
        createOp = await fillAndSign({
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
        const op1 = await fillAndSign({
          initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory),
          callData: accountExecCounterFromEntryPoint.data,
          callGasLimit: 2e6,
          verificationGasLimit: 2e6
        }, accountOwner1, entryPoint)

        const op2 = await fillAndSign({
          callData: accountExecCounterFromEntryPoint.data,
          sender: account2.address,
          callGasLimit: 2e6,
          verificationGasLimit: 76000
        }, accountOwner2, entryPoint)

        await entryPoint.callStatic.simulateValidation(op2, { gasPrice: 1e9 }).catch(simulationResultCatch)

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
        await aggAccount.initialize(zeroAddress())
        await aggAccount2.initialize(zeroAddress())
        await ethersSigner.sendTransaction({ to: aggAccount.address, value: parseEther('0.1') })
        await ethersSigner.sendTransaction({ to: aggAccount2.address, value: parseEther('0.1') })
      })
      it('should fail to execute aggregated account without an aggregator', async () => {
        const userOp = await fillAndSign({
          sender: aggAccount.address
        }, accountOwner, entryPoint)

        // no aggregator is kind of "wrong aggregator"
        await expect(entryPoint.handleOps([userOp], beneficiaryAddress)).to.revertedWith('wrong aggregator')
      })
      it('should fail to execute aggregated account with wrong aggregator', async () => {
        const userOp = await fillAndSign({
          sender: aggAccount.address
        }, accountOwner, entryPoint)

        const wrongAggregator = await new TestSignatureAggregator__factory(ethersSigner).deploy()
        const sig = HashZero

        await expect(entryPoint.handleAggregatedOps([{
          userOps: [userOp],
          aggregator: wrongAggregator.address,
          signature: sig
        }], beneficiaryAddress)).to.revertedWith('wrong aggregator')
      })

      it('should reject non-contract (address(1)) aggregator', async () => {
        // this is just sanity check that the compiler indeed reverts on a call to "validateSignatures()" to nonexistent contracts
        const address1 = hexZeroPad('0x1', 20)
        const aggAccount1 = await new TestAggregatedAccount__factory(ethersSigner).deploy(entryPoint.address, address1)
        await aggAccount1.initialize(zeroAddress())

        const userOp = await fillAndSign({
          sender: aggAccount1.address,
          maxFeePerGas: 0
        }, accountOwner, entryPoint)

        const sig = HashZero

        expect(await entryPoint.handleAggregatedOps([{
          userOps: [userOp],
          aggregator: address1,
          signature: sig
        }], beneficiaryAddress).catch(e => e.message))
          .to.match(/reverted without a reason string|function call to a non-contract account/)
        // (different error in coverage mode (because of different solidity settings)
      })

      it('should fail to execute aggregated account with wrong agg. signature', async () => {
        const userOp = await fillAndSign({
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
        await aggAccount3.initialize(zeroAddress())
        await ethersSigner.sendTransaction({ to: aggAccount3.address, value: parseEther('0.1') })

        const userOp1 = await fillAndSign({
          sender: aggAccount.address
        }, accountOwner, entryPoint)
        const userOp2 = await fillAndSign({
          sender: aggAccount2.address
        }, accountOwner, entryPoint)
        const userOp_agg3 = await fillAndSign({
          sender: aggAccount3.address
        }, accountOwner, entryPoint)
        const userOp_noAgg = await fillAndSign({
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
          let userOp: UserOperation
          before(async () => {
            const factory = await new TestAggregatedAccountFactory__factory(ethersSigner).deploy(entryPoint.address, aggregator.address)
            initCode = await getAggregatedAccountInitCode(entryPoint.address, factory)
            addr = await entryPoint.callStatic.getSenderAddress(initCode).catch(e => e.errorArgs.sender)
            await ethersSigner.sendTransaction({ to: addr, value: parseEther('0.1') })
            userOp = await fillAndSign({
              initCode,
              nonce: 10
            }, accountOwner, entryPoint)
          })
          it('simulateValidation should return aggregator and its stake', async () => {
            await aggregator.addStake(entryPoint.address, 3, { value: TWO_ETH })
            const { aggregatorInfo } = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultWithAggregationCatch)
            expect(aggregatorInfo.actualAggregator).to.equal(aggregator.address)
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
        const op = await fillAndSign({
          paymasterAndData: pm,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(account2Owner.address, simpleAccountFactory),
          verificationGasLimit: 3e6,
          callGasLimit: 1e6
        }, account2Owner, entryPoint)
        await expect(entryPoint.simulateValidation(op)).to.revertedWith('"AA30 paymaster not deployed"')
      })

      it('should fail if paymaster has no deposit', async function () {
        const op = await fillAndSign({
          paymasterAndData: paymaster.address,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(account2Owner.address, simpleAccountFactory),

          verificationGasLimit: 3e6,
          callGasLimit: 1e6
        }, account2Owner, entryPoint)
        const beneficiaryAddress = createAddress()
        await expect(entryPoint.handleOps([op], beneficiaryAddress)).to.revertedWith('"AA31 paymaster deposit too low"')
      })

      it('paymaster should pay for tx', async function () {
        await paymaster.deposit({ value: ONE_ETH })
        const op = await fillAndSign({
          paymasterAndData: paymaster.address,
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

        const op = await fillAndSign({
          paymasterAndData: paymaster.address,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountInitCode(anOwner.address, simpleAccountFactory)
        }, anOwner, entryPoint)

        const { paymasterInfo } = await entryPoint.callStatic.simulateValidation(op).catch(simulationResultCatch)
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
          const userOp = await fillAndSign({
            sender: account.address
          }, sessionOwner, entryPoint)
          const ret = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
          expect(ret.returnInfo.validUntil).to.eql(now + 60 - 1)
          expect(ret.returnInfo.validAfter).to.eql(100)
        })

        it('should not reject expired owner', async () => {
          const expiredOwner = createAccountOwner()
          await account.addTemporaryOwner(expiredOwner.address, 123, now - 60)
          const userOp = await fillAndSign({
            sender: account.address
          }, expiredOwner, entryPoint)
          const ret = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
          expect(ret.returnInfo.validUntil).eql(now - 60 - 1)
          expect(ret.returnInfo.validAfter).to.eql(123)
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
          const timeRange = defaultAbiCoder.encode(['uint64', 'uint64'], [123, now + 60])
          const userOp = await fillAndSign({
            sender: account.address,
            paymasterAndData: hexConcat([paymaster.address, timeRange])
          }, ethersSigner, entryPoint)
          const ret = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
          expect(ret.returnInfo.validUntil).to.eql(now + 60 - 1)
          expect(ret.returnInfo.validAfter).to.eql(123)
        })

        it('should not reject expired paymaster request', async () => {
          const timeRange = defaultAbiCoder.encode(['uint64', 'uint64'], [321, now - 60])
          const userOp = await fillAndSign({
            sender: account.address,
            paymasterAndData: hexConcat([paymaster.address, timeRange])
          }, ethersSigner, entryPoint)
          const ret = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
          expect(ret.returnInfo.validUntil).to.eql(now - 60 - 1)
          expect(ret.returnInfo.validAfter).to.eql(321)
        })

        // helper method
        async function createOpWithPaymasterParams (owner: Wallet, after: number, until: number): Promise<UserOperation> {
          const timeRange = defaultAbiCoder.encode(['uint64', 'uint64'], [after, until])
          return await fillAndSign({
            sender: account.address,
            paymasterAndData: hexConcat([paymaster.address, timeRange])
          }, owner, entryPoint)
        }

        describe('time-range overlap of paymaster and account should intersect', () => {
          let owner: Wallet
          before(async () => {
            owner = createAccountOwner()
            await account.addTemporaryOwner(owner.address, 100, 500)
          })

          async function simulateWithPaymasterParams (after: number, until: number): Promise<any> {
            const userOp = await createOpWithPaymasterParams(owner, after, until)
            const ret = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
            return ret.returnInfo
          }

          // sessionOwner has a range of 100.. now+60
          it('should use lower "after" value of paymaster', async () => {
            expect((await simulateWithPaymasterParams(10, 1000)).validAfter).to.eql(100)
          })
          it('should use lower "after" value of account', async () => {
            expect((await simulateWithPaymasterParams(200, 1000)).validAfter).to.eql(200)
          })
          it('should use higher "until" value of paymaster', async () => {
            expect((await simulateWithPaymasterParams(10, 400)).validUntil).to.eql(399)
          })
          it('should use higher "until" value of account', async () => {
            expect((await simulateWithPaymasterParams(200, 600)).validUntil).to.eql(499)
          })

          it('handleOps should revert on expired paymaster request', async () => {
            const userOp = await createOpWithPaymasterParams(sessionOwner, now + 100, now + 200)
            await expect(entryPoint.handleOps([userOp], beneficiary))
              .to.revertedWith('AA32 paymaster expired or not due')
          })
        })
      })
      describe('handleOps should abort on time-range', () => {
        it('should revert on expired account', async () => {
          const expiredOwner = createAccountOwner()
          await account.addTemporaryOwner(expiredOwner.address, 1, 2)
          const userOp = await fillAndSign({
            sender: account.address
          }, expiredOwner, entryPoint)
          await expect(entryPoint.handleOps([userOp], beneficiary))
            .to.revertedWith('AA22 expired or not due')
        })

        it('should revert on date owner', async () => {
          const futureOwner = createAccountOwner()
          await account.addTemporaryOwner(futureOwner.address, now + 100, now + 200)
          const userOp = await fillAndSign({
            sender: account.address
          }, futureOwner, entryPoint)
          await expect(entryPoint.handleOps([userOp], beneficiary))
            .to.revertedWith('AA22 expired or not due')
        })
      })
    })
  })
})
