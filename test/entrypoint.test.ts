import './aa.init'
import {beforeEach, describe} from 'mocha'
import {BigNumber, Wallet} from "ethers";
import {expect} from "chai";
import {
  SimpleWallet,
  SimpleWallet__factory,
  EntryPoint,
  EntryPoint__factory,
  TestCounter,
  TestCounter__factory,
  TestUtil,
  TestUtil__factory,
} from "../typechain";
import {
  AddressZero,
  createWalletOwner,
  fund,
  checkForGeth,
  rethrow,
  tostr,
  WalletConstructor,
  calcGasUsage,
  objdump,
  tonumber,
  checkForBannedOps,
  ONE_ETH,
  TWO_ETH,
  deployEntryPoint,
  getBalance
} from "./testutils";
import {fillAndSign, DefaultsForUserOp} from "./UserOp";
import {UserOperation} from "./UserOperation";
import {PopulatedTransaction} from "ethers/lib/ethers";
import {ethers} from 'hardhat'
import {toBuffer} from "ethereumjs-util";
import {defaultAbiCoder, parseEther} from "ethers/lib/utils";
import exp from "constants";

describe("EntryPoint", function () {

  let entryPoint: EntryPoint
  let entryPointView: EntryPoint

  let testUtil: TestUtil
  let walletOwner: Wallet
  let ethersSigner = ethers.provider.getSigner();
  let wallet: SimpleWallet

  const unstakeDelayBlocks = 2

  before(async function () {

    await checkForGeth()
    testUtil = await new TestUtil__factory(ethersSigner).deploy()
    entryPoint = await deployEntryPoint(0,unstakeDelayBlocks)
    //static call must come from address zero, to validate it can only be called off-chain.
    entryPointView = entryPoint.connect(ethers.provider.getSigner(AddressZero))
    walletOwner = createWalletOwner()
    wallet = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, await walletOwner.getAddress())
    await fund(wallet)
  })

  describe('Stake Management', () => {
    let addr: string
    before(async () => {
      addr = await ethersSigner.getAddress()
    })

    describe('without stake', () => {
      it('should return no stake', async () => {
        expect(await entryPoint.isPaymasterStaked(addr, TWO_ETH)).to.eq(false)
      })
      it('should fail to unlock', async () => {
        await expect(entryPoint.unlockStake()).to.revertedWith('no stake')
      })
    })
    describe('with stake of 2 eth', () => {
      before(async () => {
        await entryPoint.addStake(2, {value: TWO_ETH})
      })
      it('should report "staked" state', async () => {
        expect(await entryPoint.isPaymasterStaked(addr, 0)).to.eq(true)
        const {stake, withdrawStake, withdrawBlock} = await entryPoint.getStakeInfo(addr)
        expect({stake, withdrawStake, withdrawBlock}).to.eql({
          stake: parseEther('2'),
          withdrawStake: BigNumber.from(0),
          withdrawBlock: 0
        })
      })


      it('should succeed to stake again', async () => {
        const {stake} = await entryPoint.getStakeInfo(addr)
        expect(stake).to.eq(TWO_ETH)
        await entryPoint.addStake(2, {value: ONE_ETH})
        const {stake: stakeAfter} = await entryPoint.getStakeInfo(addr)
        expect(stakeAfter).to.eq(parseEther('3'))
      })
      it('should fail to withdraw before unlock', async () => {
        await expect(entryPoint.withdrawStake(AddressZero)).to.revertedWith('no unlocked stake')
      })
      describe('with unlocked stake', () => {
        before(async () => {
          await entryPoint.unlockStake()
        })
        it('should report as "not staked"', async () => {
          expect(await entryPoint.isPaymasterStaked(addr, TWO_ETH)).to.eq(false)
        })
        it('should report unstake state', async () => {
          const withdrawBlock1 = await ethers.provider.getBlockNumber() + unstakeDelayBlocks
          const {stake, withdrawStake, withdrawBlock} = await entryPoint.getStakeInfo(addr)
          expect({stake, withdrawStake, withdrawBlock}).to.eql({
            stake: BigNumber.from(0),
            withdrawStake: parseEther('3'),
            withdrawBlock: withdrawBlock1
          })
          expect(await entryPoint.isPaymasterStaked(addr, TWO_ETH)).to.eq(false)
        })
        it('should fail to withdraw before unlock timeout', async () => {
          await expect(entryPoint.withdrawStake(AddressZero)).to.revertedWith('Withdrawal is not due')
        })
        it('should fail to unlock again', async () => {
          await expect(entryPoint.unlockStake()).to.revertedWith('already pending')
        })
        describe('after unstake delay', () => {
          before(async () => {
            // dummy 2 transactions to advance blocks
            await ethersSigner.sendTransaction({to: addr})
            await ethersSigner.sendTransaction({to: addr})
          })
          it('adding stake should reset "unlockStake"', async () => {
            let snap
            try {
              snap = await ethers.provider.send('evm_snapshot', [])

              await ethersSigner.sendTransaction({to: addr})
              await entryPoint.addStake(2, {value: ONE_ETH})
              const {stake, withdrawStake, withdrawBlock} = await entryPoint.getStakeInfo(addr)
              expect({stake, withdrawStake, withdrawBlock}).to.eql({
                stake: parseEther('4'),
                withdrawStake: parseEther('0'),
                withdrawBlock: 0
              })
            } finally {
              await ethers.provider.send('evm_revert', [snap])
            }
          })

          it('should report unstaked state', async () => {
            expect(await entryPoint.isPaymasterStaked(addr, TWO_ETH)).to.eq(false)
          })
          it('should fail to unlock again', async () => {
            await expect(entryPoint.unlockStake()).to.revertedWith('already pending')
          })
          it('should succeed to withdraw', async () => {
            const {withdrawStake} = await entryPoint.getStakeInfo(addr)
            const addr1 = createWalletOwner().address
            await entryPoint.withdrawStake(addr1)
            expect(await ethers.provider.getBalance(addr1)).to.eq(withdrawStake)
            const {stake, withdrawStake: withdrawStakeAfter, withdrawBlock} = await entryPoint.getStakeInfo(addr)

            expect({stake, withdrawStakeAfter, withdrawBlock}).to.eql({
              stake: BigNumber.from(0),
              withdrawStakeAfter: BigNumber.from(0),
              withdrawBlock: 0
            })
          })
          it('should fail to withdraw again', async () => {
            await expect(entryPoint.withdrawStake(AddressZero)).to.revertedWith('no unlocked stake')
          })
        })
      })
    })
    describe('with deposit (stake without lock)', () => {
      let owner: string
      let wallet: SimpleWallet
      before(async()=>{
        owner = await ethersSigner.getAddress()
        wallet = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, owner)
        const ret = await wallet.addDeposit({value:ONE_ETH})
        expect(await getBalance(wallet.address)).to.equal(0)
      })
      it('should fail to unlock deposit (its not locked)', async () => {
        //wallet doesn't have "unlock" api, so we test it with static call.
        await expect(entryPoint.connect(wallet.address).callStatic.unlockStake()).to.revertedWith('no stake')
      })
      it('should withdraw with no unlock', async () => {
        await wallet.withdrawDeposit(wallet.address)
        expect(await getBalance(wallet.address)).to.equal(1e18)
      })
    })
  })
  describe('#simulateWalletValidation', () => {
    const walletOwner1 = createWalletOwner()
    let wallet1: SimpleWallet

    before(async () => {
      wallet1 = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, await walletOwner1.getAddress())
    })
    it('should fail on-chain', async () => {
      const op = await fillAndSign({sender: wallet1.address}, walletOwner1, entryPoint)
      await expect(entryPoint.simulateWalletValidation(op)).to.revertedWith('must be called off-chain')
    });
    it('should fail if verifyUserOp fails', async () => {
      //using wrong owner for wallet1
      const op = await fillAndSign({sender: wallet1.address}, walletOwner, entryPoint)
      await expect(entryPointView.callStatic.simulateWalletValidation(op).catch(rethrow())).to
        .revertedWith('wrong signature')
    });
    it('should succeed if verifyUserOp succeeds', async () => {
      const op = await fillAndSign({sender: wallet1.address}, walletOwner1, entryPoint)
      await fund(wallet1)
      const ret = await entryPointView.callStatic.simulateWalletValidation(op).catch(rethrow())
      console.log('   === simulate result', ret)
    });
    it('should fail creation for wrong sender', async () => {
      const op1 = await fillAndSign({
        initCode: WalletConstructor(entryPoint.address, walletOwner1.address),
        sender: '0x'.padEnd(42, '1')
      }, walletOwner1, entryPoint)
      await expect(entryPointView.callStatic.simulateWalletValidation(op1).catch(rethrow()))
        .to.revertedWith('sender doesn\'t match create2 address')
    })

    it('should succeed for creating a wallet', async () => {
      const op1 = await fillAndSign({
        initCode: WalletConstructor(entryPoint.address, walletOwner1.address),
      }, walletOwner1, entryPoint)
      await fund(op1.sender)
      await entryPointView.callStatic.simulateWalletValidation(op1).catch(rethrow())
    })

    it('should not use banned ops during simulateWalletValidation', async () => {
      const op1 = await fillAndSign({
        initCode: WalletConstructor(entryPoint.address, walletOwner1.address),
      }, walletOwner1, entryPoint)
      await fund(op1.sender)
      await fund(AddressZero)
      //we must create a real transaction to debug, and it must come from address zero:
      await ethers.provider.send('hardhat_impersonateAccount', [AddressZero])
      const ret = await entryPointView.simulateWalletValidation(op1)

      await checkForBannedOps(ret!.hash)
    })

  })

  describe('without paymaster (account pays in eth)', () => {
    describe('#handleOps', () => {
      let counter: TestCounter
      let walletExecFromEntryPoint: PopulatedTransaction
      before(async () => {

        counter = await new TestCounter__factory(ethersSigner).deploy()
        const count = await counter.populateTransaction.count()
        const execCounterCount = await wallet.populateTransaction.exec(counter.address, count.data!)
        walletExecFromEntryPoint = await wallet.populateTransaction.execFromEntryPoint(execCounterCount.data!)
      })

      it('wallet should pay for tx', async function () {
        const op = await fillAndSign({
          sender: wallet.address,
          callData: walletExecFromEntryPoint.data,
          verificationGas: 1e6,
          callGas: 1e6
        }, walletOwner, entryPoint)
        const redeemerAddress = Wallet.createRandom().address

        const countBefore = await counter.counters(wallet.address)
        //for estimateGas, must specify maxFeePerGas, otherwise our gas check fails
        console.log('  == est gas=', await entryPoint.estimateGas.handleOps([op], redeemerAddress, {maxFeePerGas: 1e9}).then(tostr))

        //must specify at least on of maxFeePerGas, gasLimit
        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        const rcpt = await entryPoint.handleOps([op], redeemerAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 1e7
        }).then(t => t.wait())

        const countAfter = await counter.counters(wallet.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)
        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)

        await calcGasUsage(rcpt, entryPoint, redeemerAddress)
      });

      it('if wallet has a stake, it should use it to pay', async function () {
        await wallet.addDeposit({value: ONE_ETH})
        const op = await fillAndSign({
          sender: wallet.address,
          callData: walletExecFromEntryPoint.data,
          verificationGas: 1e6,
          callGas: 1e6
        }, walletOwner, entryPoint)
        const redeemerAddress = Wallet.createRandom().address

        const countBefore = await counter.counters(wallet.address)
        //for estimateGas, must specify maxFeePerGas, otherwise our gas check fails
        console.log('  == est gas=', await entryPoint.estimateGas.handleOps([op], redeemerAddress, {maxFeePerGas: 1e9}).then(tostr))

        const balBefore = await getBalance(wallet.address)
        const stakeBefore = await entryPoint.getStakeInfo(wallet.address).then(info => info.stake)
        //must specify at least one of maxFeePerGas, gasLimit
        // (gasLimit, to prevent estimateGas to fail on missing maxFeePerGas, see above..)
        const rcpt = await entryPoint.handleOps([op], redeemerAddress, {
          maxFeePerGas: 1e9,
          gasLimit: 1e7
        }).then(t => t.wait())

        const countAfter = await counter.counters(wallet.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)
        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)

        const balAfter = await getBalance(wallet.address)
        const stakeAfter = await entryPoint.getStakeInfo(wallet.address).then(info => info.stake)
        expect(balAfter).to.equal(balBefore, 'should pay from stake, not balance')
        let stakeUsed = stakeBefore.sub(stakeAfter)
        expect(await ethers.provider.getBalance(redeemerAddress)).to.equal(stakeUsed)

        await calcGasUsage(rcpt, entryPoint, redeemerAddress)
      });

      it('#handleOp (single)', async () => {
        const redeemerAddress = Wallet.createRandom().address

        const op = await fillAndSign({
          sender: wallet.address,
          callData: walletExecFromEntryPoint.data,
        }, walletOwner, entryPoint)

        const countBefore = await counter.counters(wallet.address)
        const rcpt = await entryPoint.handleOp(op, redeemerAddress, {
          gasLimit: 1e7
        }).then(t => t.wait())
        const countAfter = await counter.counters(wallet.address)
        expect(countAfter.toNumber()).to.equal(countBefore.toNumber() + 1)

        console.log('rcpt.gasUsed=', rcpt.gasUsed.toString(), rcpt.transactionHash)
        await calcGasUsage(rcpt, entryPoint, redeemerAddress)

      });
    })

    describe('create account', () => {
      let createOp: UserOperation
      let created = false
      let redeemerAddress = Wallet.createRandom().address //1

      it('should reject create if sender address is wrong', async () => {

        const op = await fillAndSign({
          initCode: WalletConstructor(entryPoint.address, walletOwner.address),
          verificationGas: 2e6,
          sender: '0x'.padEnd(42, '1')
        }, walletOwner, entryPoint)

        await expect(entryPoint.callStatic.handleOps([op], redeemerAddress, {
          gasLimit: 1e7
        })).to.revertedWith('sender doesn\'t match create2 address')
      });

      it('should reject create if account not funded', async () => {

        const op = await fillAndSign({
          initCode: WalletConstructor(entryPoint.address, walletOwner.address),
          verificationGas: 2e6
        }, walletOwner, entryPoint)

        expect(await ethers.provider.getBalance(op.sender)).to.eq(0)

        await expect(entryPoint.callStatic.handleOps([op], redeemerAddress, {
          gasLimit: 1e7
        })).to.revertedWith('didn\'t pay prefund')

        // await expect(await ethers.provider.getCode(op.sender).then(x => x.length)).to.equal(2, "wallet exists before creation")
      });

      it('should succeed to create account after prefund', async () => {

        const preAddr = await entryPoint.getSenderAddress(WalletConstructor(entryPoint.address, walletOwner.address), 0)
        await fund(preAddr)
        createOp = await fillAndSign({
          initCode: WalletConstructor(entryPoint.address, walletOwner.address),
          callGas: 1e7,
          verificationGas: 2e6

        }, walletOwner, entryPoint)

        await expect(await ethers.provider.getCode(preAddr).then(x => x.length)).to.equal(2, "wallet exists before creation")
        const rcpt = await entryPoint.handleOps([createOp], redeemerAddress, {
          gasLimit: 1e7,
        }).then(tx => tx.wait()).catch(rethrow())
        created = true
        await calcGasUsage(rcpt!, entryPoint, redeemerAddress)
      });

      it('should reject if account already created', async function () {
        const preAddr = await entryPoint.getSenderAddress(WalletConstructor(entryPoint.address, walletOwner.address), 0)
        if (await ethers.provider.getCode(preAddr).then(x => x.length) == 2)
          this.skip()

        await expect(entryPoint.callStatic.handleOps([createOp], redeemerAddress, {
          gasLimit: 1e7
        })).to.revertedWith('create2 failed')
      });
    })

    describe('batch multiple requests', () => {
      /**
       * attempt a batch:
       * 1. create wallet1 + "initialize" (by calling counter.count())
       * 2. wallet2.exec(counter.count()
       *    (wallet created in advance)
       */
      let counter: TestCounter
      let walletExecCounterFromEntryPoint: PopulatedTransaction
      const redeemerAddress = Wallet.createRandom().address
      const walletOwner1 = createWalletOwner()
      let wallet1: string
      let walletOwner2 = createWalletOwner()
      let wallet2: SimpleWallet
      let prebalance1: BigNumber
      let prebalance2: BigNumber

      before(async () => {
        counter = await new TestCounter__factory(ethersSigner).deploy()
        const count = await counter.populateTransaction.count()
        const execCounterCount = await wallet.populateTransaction.exec(counter.address, count.data!)
        walletExecCounterFromEntryPoint = await wallet.populateTransaction.execFromEntryPoint(execCounterCount.data!)
        wallet1 = await entryPoint.getSenderAddress(WalletConstructor(entryPoint.address, walletOwner1.address), 0)
        wallet2 = await new SimpleWallet__factory(ethersSigner).deploy(entryPoint.address, walletOwner2.address)
        await fund(wallet1)
        await fund(wallet2.address)
        //execute and incremtn counter
        const op1 = await fillAndSign({
          initCode: WalletConstructor(entryPoint.address, walletOwner1.address),
          callData: walletExecCounterFromEntryPoint.data,
          callGas: 2e6,
          verificationGas: 2e6
        }, walletOwner1, entryPoint)

        // console.log('op=', {...op1, callData: op1.callData.length, initCode: op1.initCode.length})

        const op2 = await fillAndSign({
          callData: walletExecCounterFromEntryPoint.data,
          sender: wallet2.address,
          callGas: 2e6,
          verificationGas: 76000,
        }, walletOwner2, entryPoint)

        const estim = await entryPointView.callStatic.simulateWalletValidation(op2, {gasPrice: 1e9})
        const estim1 = await entryPointView.simulatePaymasterValidation(op2, estim!, {gasPrice: 1e9})
        const verificationGas = estim.add(estim1.gasUsedByPayForOp)

        await fund(op1.sender)
        await fund(wallet2.address)
        prebalance1 = await ethers.provider.getBalance((wallet1))
        prebalance2 = await ethers.provider.getBalance((wallet2.address))
        await entryPoint.handleOps([op1!, op2], redeemerAddress).catch((rethrow())).then(r => r!.wait())
        // console.log(ret.events!.map(e=>({ev:e.event, ...objdump(e.args!)})))
      })
      it('should execute', async () => {
        expect(await counter.counters(wallet1)).equal(1)
        expect(await counter.counters(wallet2.address)).equal(1)
      })
      it('should pay for tx', async () => {
        const cost1 = prebalance1.sub(await ethers.provider.getBalance(wallet1))
        const cost2 = prebalance2.sub(await ethers.provider.getBalance(wallet2.address))
        // console.log('cost1=', cost1)
        // console.log('cost2=', cost2)
      })
    });
  })
})
