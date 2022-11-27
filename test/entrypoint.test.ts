import './aa.init'
import { BigNumber, Wallet } from 'ethers'
import { expect } from 'chai'
import {
  EntryPoint,
  SimpleAccount,
  SimpleAccount__factory,
  TestCounter,
  TestCounter__factory,
  TestExpirePaymaster,
  TestExpirePaymaster__factory,
  TestExpiryAccount,
  TestExpiryAccount__factory,
  TestPaymasterAcceptAll,
  TestPaymasterAcceptAll__factory
} from '../typechain'
import {
  AddressZero,
  createAccountOwner,
  fund,
  checkForGeth,
  rethrow,
  tostr,
  getAccountDeployer,
  calcGasUsage,
  checkForBannedOps,
  ONE_ETH,
  TWO_ETH,
  deployEntryPoint,
  getBalance,
  createAddress,
  getAccountAddress,
  HashZero,
  getAggregatedAccountDeployer,
  simulationResultCatch,
  simulationResultWithAggregationCatch
} from './testutils'
import { fillAndSign, getUserOpHash } from './UserOp'
import { UserOperation } from './UserOperation'
import { PopulatedTransaction } from 'ethers/lib/ethers'
import { ethers } from 'hardhat'
import { defaultAbiCoder, hexConcat, hexZeroPad, parseEther } from 'ethers/lib/utils'
import { debugTransaction } from './debugTx'
import { BytesLike } from '@ethersproject/bytes'
import { TestSignatureAggregator } from '../typechain/contracts/samples/TestSignatureAggregator'
import { TestAggregatedAccount } from '../typechain/contracts/samples/TestAggregatedAccount'
import {
  TestSignatureAggregator__factory
} from '../typechain/factories/contracts/samples/TestSignatureAggregator__factory'
import { TestAggregatedAccount__factory } from '../typechain/factories/contracts/samples/TestAggregatedAccount__factory'

describe('EntryPoint', function () {
  let entryPoint: EntryPoint

  let accountOwner: Wallet
  const ethersSigner = ethers.provider.getSigner()
  let account: SimpleAccount

  const globalUnstakeDelaySec = 2
  const paymasterStake = ethers.utils.parseEther('2')

  before(async function () {
    await checkForGeth()

    const chainId = await ethers.provider.getNetwork().then(net => net.chainId)

    entryPoint = await deployEntryPoint()

    accountOwner = createAccountOwner()
    account = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, await accountOwner.getAddress())
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
      let owner: string
      let account: SimpleAccount
      before(async () => {
        owner = await ethersSigner.getAddress()
        account = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, owner)
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
      account1 = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, await accountOwner1.getAddress())
    })

    it('should fail if validateUserOp fails', async () => {
      // using wrong owner for account1
      const op = await fillAndSign({ sender: account1.address }, accountOwner, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(op).catch(rethrow())).to
        .revertedWith('wrong signature')
    })

    it('should succeed if validateUserOp succeeds', async () => {
      const op = await fillAndSign({ sender: account1.address }, accountOwner1, entryPoint)
      await fund(account1)
      await entryPoint.callStatic.simulateValidation(op).catch(simulationResultCatch)
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
        initCode: getAccountDeployer(entryPoint.address, accountOwner1.address),
        sender: '0x'.padEnd(42, '1'),
        verificationGasLimit: 1e6
      }, accountOwner1, entryPoint)
      await expect(entryPoint.callStatic.simulateValidation(op1).catch(rethrow()))
        .to.revertedWith('sender doesn\'t match initCode address')
    })

    it('should succeed for creating an account', async () => {
      const sender = getAccountAddress(entryPoint.address, accountOwner1.address)
      const op1 = await fillAndSign({
        sender,
        initCode: getAccountDeployer(entryPoint.address, accountOwner1.address)
      }, accountOwner1, entryPoint)
      await fund(op1.sender)

      await entryPoint.callStatic.simulateValidation(op1).catch(simulationResultCatch)
    })

    it('should not call initCode from entrypoint', async () => {
      // a possible attack: call an account's execFromEntryPoint through initCode. This might lead to stolen funds.
      const account = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, accountOwner.address)
      const sender = createAddress()
      const op1 = await fillAndSign({
        initCode: hexConcat([
          account.address,
          account.interface.encodeFunctionData('execFromEntryPoint', [sender, 0, '0x'])
        ]),
        sender
      }, accountOwner, entryPoint)
      const error = await entryPoint.callStatic.simulateValidation(op1).catch(e => e)
      expect(error.message).to.match(/initCode failed/, error)
    })

    it('should not use banned ops during simulateValidation', async () => {
      const op1 = await fillAndSign({
        initCode: getAccountDeployer(entryPoint.address, accountOwner1.address),
        sender: getAccountAddress(entryPoint.address, accountOwner1.address)
      }, accountOwner1, entryPoint)
      await fund(op1.sender)
      await entryPoint.simulateValidation(op1, { gasLimit: 10e6 }).catch(e => e)
      const block = await ethers.provider.getBlock('latest')
      const hash = block.transactions[0]
      await checkForBannedOps(hash, false)
    })
  })

  describe('without paymaster (account pays in eth)', () => {
    describe('#handleOps', () => {
      let counter: TestCounter
      let accountExecFromEntryPoint: PopulatedTransaction
      before(async () => {
        counter = await new TestCounter__factory(ethersSigner).deploy()
        const count = await counter.populateTransaction.count()
        accountExecFromEntryPoint = await account.populateTransaction.execFromEntryPoint(counter.address, 0, count.data!)
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
    })

    describe('create account', () => {
      if (process.env.COVERAGE != null) {
        return
      }
      let createOp: UserOperation
      const beneficiaryAddress = createAddress() // 1

      it('should reject create if sender address is wrong', async () => {
        const op = await fillAndSign({
          initCode: getAccountDeployer(entryPoint.address, accountOwner.address),
          verificationGasLimit: 2e6,
          sender: '0x'.padEnd(42, '1')
        }, accountOwner, entryPoint)

        await expect(entryPoint.callStatic.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7
        })).to.revertedWith('sender doesn\'t match initCode address')
      })

      it('should reject create if account not funded', async () => {
        const op = await fillAndSign({
          initCode: getAccountDeployer(entryPoint.address, accountOwner.address),
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
        const preAddr = getAccountAddress(entryPoint.address, accountOwner.address)
        await fund(preAddr)
        createOp = await fillAndSign({
          initCode: getAccountDeployer(entryPoint.address, accountOwner.address),
          callGasLimit: 1e7,
          verificationGasLimit: 2e6

        }, accountOwner, entryPoint)

        await expect(await ethers.provider.getCode(preAddr).then(x => x.length)).to.equal(2, 'account exists before creation')
        const rcpt = await entryPoint.handleOps([createOp], beneficiaryAddress, {
          gasLimit: 1e7
        }).then(async tx => await tx.wait()).catch(rethrow())
        await calcGasUsage(rcpt!, entryPoint, beneficiaryAddress)
      })

      it('should reject if account already created', async function () {
        const preAddr = getAccountAddress(entryPoint.address, accountOwner.address)
        if (await ethers.provider.getCode(preAddr).then(x => x.length) === 2) {
          this.skip()
        }

        await expect(entryPoint.callStatic.handleOps([createOp], beneficiaryAddress, {
          gasLimit: 1e7
        })).to.revertedWith('sender already constructed')
      })
    })

    describe('batch multiple requests', () => {
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
        accountExecCounterFromEntryPoint = await account.populateTransaction.execFromEntryPoint(counter.address, 0, count.data!)
        account1 = getAccountAddress(entryPoint.address, accountOwner1.address)
        account2 = await new SimpleAccount__factory(ethersSigner).deploy(entryPoint.address, accountOwner2.address)
        await fund(account1)
        await fund(account2.address)
        // execute and increment counter
        const op1 = await fillAndSign({
          initCode: getAccountDeployer(entryPoint.address, accountOwner1.address),
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
        await entryPoint.handleAggregatedOps(aggInfos, beneficiaryAddress, { gasLimit: 3e6 })
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
            initCode = await getAggregatedAccountDeployer(entryPoint.address, aggregator.address)
            addr = await entryPoint.callStatic.getSenderAddress(initCode).catch(e => e.errorArgs.sender)
            await ethersSigner.sendTransaction({ to: addr, value: parseEther('0.1') })
            userOp = await fillAndSign({
              initCode,
              nonce: 10
            }, accountOwner, entryPoint)
          })
          it('simulateValidation should return aggregator and its stake', async () => {
            await aggregator.addStake(entryPoint.address, 3, { value: TWO_ETH })
            const { aggregationInfo } = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultWithAggregationCatch)
            expect(aggregationInfo.actualAggregator).to.equal(aggregator.address)
            expect(aggregationInfo.aggregatorStake).to.equal(TWO_ETH)
            expect(aggregationInfo.aggregatorUnstakeDelay).to.equal(3)
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
        accountExecFromEntryPoint = await account.populateTransaction.execFromEntryPoint(counter.address, 0, count.data!)
      })

      it('should fail if paymaster has no deposit', async function () {
        const op = await fillAndSign({
          paymasterAndData: paymaster.address,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountDeployer(entryPoint.address, account2Owner.address),

          verificationGasLimit: 1e6,
          callGasLimit: 1e6
        }, account2Owner, entryPoint)
        const beneficiaryAddress = createAddress()
        await expect(entryPoint.handleOps([op], beneficiaryAddress)).to.revertedWith('"paymaster deposit too low"')
      })

      it('paymaster should pay for tx', async function () {
        await paymaster.deposit({ value: ONE_ETH })
        const op = await fillAndSign({
          paymasterAndData: paymaster.address,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountDeployer(entryPoint.address, account2Owner.address)
        }, account2Owner, entryPoint)
        const beneficiaryAddress = createAddress()

        const rcpt = await entryPoint.handleOps([op], beneficiaryAddress).then(async t => t.wait())

        const { actualGasCost } = await calcGasUsage(rcpt, entryPoint, beneficiaryAddress)
        const paymasterPaid = ONE_ETH.sub(await entryPoint.balanceOf(paymaster.address))
        expect(paymasterPaid).to.eql(actualGasCost)
      })
      it('simulate should return paymaster stake and delay', async () => {
        await paymaster.deposit({ value: ONE_ETH })
        const anOwner = createAccountOwner()

        const op = await fillAndSign({
          paymasterAndData: paymaster.address,
          callData: accountExecFromEntryPoint.data,
          initCode: getAccountDeployer(entryPoint.address, anOwner.address)
        }, anOwner, entryPoint)

        const { paymasterInfo } = await entryPoint.callStatic.simulateValidation(op).catch(simulationResultCatch)
        const {
          paymasterStake: simRetStake,
          paymasterUnstakeDelay: simRetDelay
        } = paymasterInfo

        expect(simRetStake).to.eql(paymasterStake)
        expect(simRetDelay).to.eql(globalUnstakeDelaySec)
      })
    })

    describe('Validation deadline', () => {
      describe('validateUserOp deadline', function () {
        let account: TestExpiryAccount
        let now: number
        before('init account with session key', async () => {
          // create a test account. The primary owner is the global ethersSigner, so that we can easily add a temporaryOwner, below
          account = await new TestExpiryAccount__factory(ethersSigner).deploy(entryPoint.address, await ethersSigner.getAddress())
          await ethersSigner.sendTransaction({ to: account.address, value: parseEther('0.1') })
          now = await ethers.provider.getBlock('latest').then(block => block.timestamp)
        })

        it('should accept non-expired owner', async () => {
          const sessionOwner = createAccountOwner()
          await account.addTemporaryOwner(sessionOwner.address, now + 60)
          const userOp = await fillAndSign({
            sender: account.address
          }, sessionOwner, entryPoint)
          const { deadline } = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
          expect(deadline).to.eql(now + 60)
        })

        it('should reject expired owner', async () => {
          const sessionOwner = createAccountOwner()
          await account.addTemporaryOwner(sessionOwner.address, now - 60)
          const userOp = await fillAndSign({
            sender: account.address
          }, sessionOwner, entryPoint)
          await expect(entryPoint.callStatic.simulateValidation(userOp)).to.revertedWith('expired')
        })
      })

      describe('validatePaymasterUserOp with deadline', function () {
        let account: TestExpiryAccount
        let paymaster: TestExpirePaymaster
        let now: number
        before('init account with session key', async () => {
          // account without eth - must be paid by paymaster.
          account = await new TestExpiryAccount__factory(ethersSigner).deploy(entryPoint.address, await ethersSigner.getAddress())
          paymaster = await new TestExpirePaymaster__factory(ethersSigner).deploy(entryPoint.address)
          await paymaster.addStake(1, { value: paymasterStake })
          await paymaster.deposit({ value: parseEther('0.1') })
          now = await ethers.provider.getBlock('latest').then(block => block.timestamp)
        })

        it('should accept non-expired paymaster request', async () => {
          const expireTime = defaultAbiCoder.encode(['uint256'], [now + 60])
          const userOp = await fillAndSign({
            sender: account.address,
            paymasterAndData: hexConcat([paymaster.address, expireTime])
          }, ethersSigner, entryPoint)
          const { deadline } = await entryPoint.callStatic.simulateValidation(userOp).catch(simulationResultCatch)
          expect(deadline).to.eql(now + 60)
        })

        it('should reject expired paymaster request', async () => {
          const expireTime = defaultAbiCoder.encode(['uint256'], [now - 60])
          const userOp = await fillAndSign({
            sender: account.address,
            paymasterAndData: hexConcat([paymaster.address, expireTime])
          }, ethersSigner, entryPoint)
          await expect(entryPoint.callStatic.simulateValidation(userOp)).to.revertedWith('expired')
        })
      })
    })
  })
})
