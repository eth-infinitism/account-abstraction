import {
  Wallet,
  concat,
  parseEther,
  resolveAddress,
  Signer,
  MaxUint256,
  AddressLike,
  ZeroAddress,
  ContractTransactionReceipt
} from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import {
  SimpleAccount,
  EntryPoint,
  LegacyTokenPaymaster,
  LegacyTokenPaymaster__factory,
  TestCounter__factory,
  SimpleAccountFactory,
  SimpleAccountFactory__factory
} from '../src/types'
import {
  createAccountOwner,
  fund,
  getBalance,
  getTokenBalance,
  rethrow,
  checkForGeth,
  calcGasUsage,
  deployEntryPoint,
  checkForBannedOps,
  createAddress,
  ONE_ETH,
  createAccount,
  getAccountAddress
} from './testutils'
import { fillAndSign } from './UserOp'
import { UserOperation } from './UserOperation'
import { hexValue } from '@ethersproject/bytes'

describe('EntryPoint with paymaster', function () {
  let entryPoint: EntryPoint
  let accountOwner: Wallet
  let ethersSigner: Signer
  let account: SimpleAccount
  const beneficiaryAddress = '0x'.padEnd(42, '1')
  let factory: SimpleAccountFactory
  let factoryAddress: string

  function getAccountDeployer (entryPoint: AddressLike, accountOwner: AddressLike, _salt: number = 0): string {
    return concat([
      factoryAddress,
      hexValue(factory.interface.encodeFunctionData('createAccount', [accountOwner, _salt])!)
    ])
  }

  before(async function () {
    ethersSigner = await ethers.provider.getSigner()
    this.timeout(20000)
    await checkForGeth()

    entryPoint = await deployEntryPoint()
    factory = await new SimpleAccountFactory__factory(await ethersSigner).deploy(entryPoint.target)
    factoryAddress = await resolveAddress(factory)

    accountOwner = createAccountOwner();
    ({ proxy: account } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.target, factory))
    await fund(account)
  })

  describe('#TokenPaymaster', () => {
    let paymaster: LegacyTokenPaymaster
    const otherAddr = createAddress()
    let ownerAddr: string
    let pmAddr: AddressLike

    before(async () => {
      paymaster = await new LegacyTokenPaymaster__factory(ethersSigner).deploy(factory.target, 'ttt', entryPoint.target)
      pmAddr = paymaster.target
      ownerAddr = await ethersSigner.getAddress()
    })

    it('owner should have allowance to withdraw funds', async () => {
      expect(await paymaster.allowance(pmAddr, ownerAddr)).to.equal(MaxUint256)
      expect(await paymaster.allowance(pmAddr, otherAddr)).to.equal(0)
    })

    it('should allow only NEW owner to move funds after transferOwnership', async () => {
      await paymaster.transferOwnership(otherAddr)
      expect(await paymaster.allowance(pmAddr, otherAddr)).to.equal(MaxUint256)
      expect(await paymaster.allowance(pmAddr, ownerAddr)).to.equal(0)
    })
  })

  describe('using TokenPaymaster (account pays in paymaster tokens)', () => {
    let paymaster: LegacyTokenPaymaster
    before(async () => {
      paymaster = await new LegacyTokenPaymaster__factory(ethersSigner).deploy(factory.target, 'tst', entryPoint.target)
      await entryPoint.depositTo(paymaster.target, { value: parseEther('1') })
      await paymaster.addStake(1, { value: parseEther('2') })
    })

    describe('#handleOps', () => {
      let calldata: string
      before(async () => {
        const updateEntryPoint = await account.withdrawDepositTo.populateTransaction(ZeroAddress, 0).then(tx => tx.data!)
        calldata = await account.execute.populateTransaction(account.target, 0, updateEntryPoint).then(tx => tx.data!)
      })
      it('paymaster should reject if account doesn\'t have tokens', async () => {
        const op = await fillAndSign({
          sender: account.target,
          paymasterAndData: await resolveAddress(paymaster.target),
          callData: calldata
        }, accountOwner, entryPoint)
        await expect(entryPoint.handleOps.staticCall([op], beneficiaryAddress, {
          gasLimit: 1e7
        })).to.revertedWith('AA33 reverted: TokenPaymaster: no balance')
        await expect(entryPoint.handleOps([op], beneficiaryAddress, {
          gasLimit: 1e7
        })).to.revertedWith('AA33 reverted: TokenPaymaster: no balance')
      })
    })

    describe('create account', () => {
      let createOp: UserOperation
      let created = false
      const beneficiaryAddress = createAddress()

      it('should reject if account not funded', async () => {
        const op = await fillAndSign({
          initCode: getAccountDeployer(entryPoint.target, accountOwner.address, 1),
          verificationGasLimit: 1e7,
          paymasterAndData: await resolveAddress(paymaster.target)
        }, accountOwner, entryPoint)
        await expect(entryPoint.handleOps.staticCall([op], beneficiaryAddress, {
          gasLimit: 1e7
        }).catch(rethrow())).to.revertedWith('TokenPaymaster: no balance')
      })

      it('should succeed to create account with tokens', async () => {
        createOp = await fillAndSign({
          initCode: getAccountDeployer(entryPoint.target, accountOwner.address, 3),
          verificationGasLimit: 2e6,
          paymasterAndData: await resolveAddress(paymaster.target),
          nonce: 0
        }, accountOwner, entryPoint)

        const preAddr = createOp.sender
        await paymaster.mintTokens(preAddr, parseEther('1'))
        // paymaster is the token, so no need for "approve" or any init function...

        await entryPoint.simulateValidation(createOp, { gasLimit: 5e6 }).catch(e => e.message)
        const [tx] = await ethers.provider.getBlock('latest').then(block => block!.transactions)
        await checkForBannedOps(tx, true)

        const rcpt = await entryPoint.handleOps([createOp], beneficiaryAddress, {
          gasLimit: 1e7
        }).catch(rethrow()).then(async tx => await tx!.wait()) as ContractTransactionReceipt
        console.log('\t== create gasUsed=', rcpt.gasUsed.toString())
        await calcGasUsage(rcpt, entryPoint)
        created = true
      })

      it('account should pay for its creation (in tst)', async function () {
        if (!created) this.skip()
        // TODO: calculate needed payment
        const ethRedeemed = await getBalance(beneficiaryAddress)
        expect(ethRedeemed).to.above(100000)

        const accountAddr = await getAccountAddress(accountOwner.address, factory)
        const postBalance = await getTokenBalance(paymaster, accountAddr)
        expect(ONE_ETH - postBalance).to.above(10000)
      })

      it('should reject if account already created', async function () {
        if (!created) this.skip()
        await expect(entryPoint.handleOps.staticCall([createOp], beneficiaryAddress, {
          gasLimit: 1e7
        }).catch(rethrow())).to.revertedWith('sender already constructed')
      })

      it('batched request should each pay for its share', async function () {
        this.timeout(20000)
        // validate context is passed correctly to postOp
        // (context is the account to pay with)

        const beneficiaryAddress = createAddress()
        const testCounter = await new TestCounter__factory(ethersSigner).deploy()
        const justEmit = testCounter.interface.encodeFunctionData('justemit')
        const execFromSingleton = account.interface.encodeFunctionData('execute', [testCounter.target, 0, justEmit])

        const ops: UserOperation[] = []
        const accounts: SimpleAccount[] = []

        for (let i = 0; i < 4; i++) {
          const { proxy: aAccount } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.target)
          await paymaster.mintTokens(aAccount.target, parseEther('1'))
          const op = await fillAndSign({
            sender: aAccount.target,
            callData: execFromSingleton,
            paymasterAndData: await resolveAddress(paymaster.target)
          }, accountOwner, entryPoint)

          accounts.push(aAccount)
          ops.push(op)
        }

        const pmBalanceBefore = await paymaster.balanceOf(paymaster.target)
        await entryPoint.handleOps(ops, beneficiaryAddress).then(async tx => tx.wait())
        const totalPaid = await paymaster.balanceOf(paymaster.target) - pmBalanceBefore
        for (let i = 0; i < accounts.length; i++) {
          const bal = await getTokenBalance(paymaster, await resolveAddress(accounts[i].target))
          const paid = parseEther('1') - bal

          // roughly each account should pay 1/4th of total price, within 15%
          // (first account pays more, for warming up..)
          expect(paid).to.be.closeTo(totalPaid / 4n, paid * 15n / 100n)
        }
      })

      // accounts attempt to grief paymaster: both accounts pass validatePaymasterUserOp (since they have enough balance)
      // but the execution of account1 drains account2.
      // as a result, the postOp of the paymaster reverts, and cause entire handleOp to revert.
      describe('grief attempt', () => {
        let account2: SimpleAccount
        let approveCallData: string
        before(async function () {
          this.timeout(20000);
          ({ proxy: account2 } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.target))
          await paymaster.mintTokens(account2.target, parseEther('1'))
          await paymaster.mintTokens(account.target, parseEther('1'))
          approveCallData = paymaster.interface.encodeFunctionData('approve', [account.target, MaxUint256])
          // need to call approve from account2. use paymaster for that
          const approveOp = await fillAndSign({
            sender: account2.target,
            callData: account2.interface.encodeFunctionData('execute', [paymaster.target, 0, approveCallData]),
            paymasterAndData: await resolveAddress(paymaster.target)
          }, accountOwner, entryPoint)
          await entryPoint.handleOps([approveOp], beneficiaryAddress)
          expect(await paymaster.allowance(account2.target, account.target)).to.eq(MaxUint256)
        })

        it('griefing attempt should cause handleOp to revert', async () => {
          // account1 is approved to withdraw going to withdraw account2's balance

          const account2Balance = await paymaster.balanceOf(account2.target)
          const transferCost = parseEther('1') - account2Balance
          const withdrawAmount = account2Balance - transferCost * 0n
          const withdrawTokens = paymaster.interface.encodeFunctionData('transferFrom', [account2.target, account.target, withdrawAmount])
          // const withdrawTokens = paymaster.interface.encodeFunctionData('transfer', [account.target, parseEther('0.1')])
          const execFromEntryPoint = account.interface.encodeFunctionData('execute', [paymaster.target, 0, withdrawTokens])

          const userOp1 = await fillAndSign({
            sender: account.target,
            callData: execFromEntryPoint,
            paymasterAndData: await resolveAddress(paymaster.target)
          }, accountOwner, entryPoint)

          // account2's operation is unimportant, as it is going to be reverted - but the paymaster will have to pay for it..
          const userOp2 = await fillAndSign({
            sender: account2.target,
            callData: execFromEntryPoint,
            paymasterAndData: await resolveAddress(paymaster.target),
            callGasLimit: 1e6
          }, accountOwner, entryPoint)

          await expect(
            entryPoint.handleOps([
              userOp1,
              userOp2
            ], beneficiaryAddress)
          ).to.be.revertedWith('transfer amount exceeds balance')
        })
      })
    })
    describe('withdraw', () => {
      const withdrawAddress = createAddress()
      it('should fail to withdraw before unstake', async function () {
        this.timeout(20000)
        await expect(
          paymaster.withdrawStake(withdrawAddress)
        ).to.revertedWith('must call unlockStake')
      })
      it('should be able to withdraw after unstake delay', async () => {
        await paymaster.unlockStake()
        const amount = await entryPoint.getDepositInfo(paymaster.target).then(info => info.stake)
        expect(amount).to.be.gte(ONE_ETH / 2n)
        await ethers.provider.send('evm_mine', [Math.floor(Date.now() / 1000) + 1000])
        await paymaster.withdrawStake(withdrawAddress)
        expect(await ethers.provider.getBalance(withdrawAddress)).to.eql(amount)
        expect(await entryPoint.getDepositInfo(paymaster.target).then(info => info.stake)).to.eq(0)
      })
    })
  })
})
