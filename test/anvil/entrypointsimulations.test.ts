import { TransactionRequest } from '@ethersproject/abstract-provider'
import { ethers, network } from 'hardhat'
import { expect } from 'chai'

import {
  EntryPoint,
  EntryPointSimulations__factory,
  SimpleAccount,
  SimpleAccountFactory
} from '../../typechain'
import { EntryPointSimulationsInterface } from '../../typechain/contracts/core/EntryPointSimulations'
import {
  checkForBannedOps,
  createAccount,
  createAccountOwner,
  createAddress,
  deployEntryPoint,
  fund, getAccountAddress, getAccountInitCode, getBalance, ONE_ETH,
  simulationResultCatch
} from '../testutils'

import EntryPointSimulations from '../../artifacts/contracts/core/EntryPointSimulations.sol/EntryPointSimulations.json'
import { fillAndSign, simulateValidation } from '../UserOp'
import { BigNumber, Wallet } from 'ethers'
import { hexConcat } from 'ethers/lib/utils'

// note: to check that the "code override" is properly supported by a node, see if this code returns '0xaa'
// { code: '0x60aa60005260206000f3' }
// 0000    60  PUSH1 0xaa
// 0002    60  PUSH1 0x00
// 0004    52  MSTORE
// 0005    60  PUSH1 0x20
// 0007    60  PUSH1 0x00
// 0009    F3  *RETURN

describe('EntryPointSimulations', function () {
  const ethersSigner = ethers.provider.getSigner()

  let account: SimpleAccount
  let accountOwner: Wallet
  let simpleAccountFactory: SimpleAccountFactory

  let entryPoint: EntryPoint
  let entryPointSimulations: EntryPointSimulationsInterface

  before(async function () {
    if (network.name !== 'anvil') {
      this.skip()
    }
    entryPoint = await deployEntryPoint()
    entryPointSimulations = EntryPointSimulations__factory.createInterface()

    accountOwner = createAccountOwner();
    ({
      proxy: account,
      accountFactory: simpleAccountFactory
    } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address))
  })

  it('should use state diff when running the simulation', async function () {
    const data = entryPointSimulations.encodeFunctionData('return777')
    const tx: TransactionRequest = {
      to: entryPoint.address,
      data
    }
    const stateOverride = {
      [entryPoint.address]: {
        code: EntryPointSimulations.deployedBytecode
      }
    }
    const simulationResult = await ethers.provider.send('eth_call', [tx, 'latest', stateOverride])
    expect(parseInt(simulationResult, 16)).to.equal(777)
  })

  describe('#simulateValidation', () => {
    const accountOwner1 = createAccountOwner()
    let account1: SimpleAccount

    before(async () => {
      ({ proxy: account1 } = await createAccount(ethersSigner, await accountOwner1.getAddress(), entryPoint.address))
      await account.addDeposit({ value: ONE_ETH })
      expect(await getBalance(account.address)).to.equal(0)
      expect(await account.getDeposit()).to.eql(ONE_ETH)
    })

    it('should fail if validateUserOp fails', async () => {
      // using wrong nonce
      const op = await fillAndSign({ sender: account.address, nonce: 1234 }, accountOwner, entryPoint)
      await expect(simulateValidation(op, entryPoint.address)).to
        .revertedWith('AA25 invalid account nonce')
    })

    it('should report signature failure without revert', async () => {
      // (this is actually a feature of the wallet, not the entrypoint)
      // using wrong owner for account1
      // (zero gas price so it doesn't fail on prefund)
      const op = await fillAndSign({ sender: account1.address, maxFeePerGas: 0 }, accountOwner, entryPoint)
      const { returnInfo } = await simulateValidation(op, entryPoint.address).catch(simulationResultCatch)
      expect(returnInfo.sigFailed).to.be.true
    })

    it('should revert if wallet not deployed (and no initcode)', async () => {
      const op = await fillAndSign({
        sender: createAddress(),
        nonce: 0,
        verificationGasLimit: 1000
      }, accountOwner, entryPoint)
      await expect(simulateValidation(op, entryPoint.address)).to
        .revertedWith('AA20 account not deployed')
    })

    it('should revert on oog if not enough verificationGas', async () => {
      const op = await fillAndSign({ sender: account.address, verificationGasLimit: 1000 }, accountOwner, entryPoint)
      await expect(simulateValidation(op, entryPoint.address)).to
        .revertedWith('AA23 reverted (or OOG)')
    })

    it('should succeed if validateUserOp succeeds', async () => {
      const op = await fillAndSign({ sender: account1.address }, accountOwner1, entryPoint)
      await fund(account1)
      await simulateValidation(op, entryPoint.address)
    })

    it('should return empty context if no paymaster', async () => {
      const op = await fillAndSign({ sender: account1.address, maxFeePerGas: 0 }, accountOwner1, entryPoint)
      const { returnInfo } = await simulateValidation(op, entryPoint.address)
      expect(returnInfo.paymasterContext).to.eql('0x')
    })

    it('should return stake of sender', async () => {
      const stakeValue = BigNumber.from(123)
      const unstakeDelay = 3
      const { proxy: account2 } = await createAccount(ethersSigner, await ethersSigner.getAddress(), entryPoint.address)
      await fund(account2)
      await account2.execute(entryPoint.address, stakeValue, entryPoint.interface.encodeFunctionData('addStake', [unstakeDelay]))
      const op = await fillAndSign({ sender: account2.address }, ethersSigner, entryPoint)
      const result = await simulateValidation(op, entryPoint.address)
      expect(result.senderInfo.stake).to.equal(stakeValue)
      expect(result.senderInfo.unstakeDelaySec).to.equal(unstakeDelay)
    })

    it('should prevent overflows: fail if any numeric value is more than 120 bits', async () => {
      const op = await fillAndSign({
        preVerificationGas: BigNumber.from(2).pow(130),
        sender: account1.address
      }, accountOwner1, entryPoint)
      await expect(
        simulateValidation(op, entryPoint.address)
      ).to.revertedWith('gas values overflow')
    })

    it('should fail creation for wrong sender', async () => {
      const op1 = await fillAndSign({
        initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory),
        sender: '0x'.padEnd(42, '1'),
        verificationGasLimit: 30e6
      }, accountOwner1, entryPoint)
      await expect(simulateValidation(op1, entryPoint.address))
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
      await simulateValidation(op0, entryPoint.address, { gas: '0xF4240' })

      const op1 = await fillAndSign({
        initCode,
        sender,
        verificationGasLimit: 1e5,
        maxFeePerGas: 0
      }, accountOwner1, entryPoint)
      await expect(simulateValidation(op1, entryPoint.address, { gas: '0xF4240' }))
        .to.revertedWith('AA13 initCode failed or OOG')
    })

    it('should succeed for creating an account', async () => {
      const sender = await getAccountAddress(accountOwner1.address, simpleAccountFactory)
      const op1 = await fillAndSign({
        sender,
        initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory)
      }, accountOwner1, entryPoint)
      await fund(op1.sender)

      await simulateValidation(op1, entryPoint.address)
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
      const error = await simulateValidation(op1, entryPoint.address).catch(e => e)
      expect(error.message).to.match(/initCode failed or OOG/, error)
    })

    // TODO: this test is impossible to do with the "state override" approach
    it.skip('should not use banned ops during simulateValidation', async () => {
      const op1 = await fillAndSign({
        initCode: getAccountInitCode(accountOwner1.address, simpleAccountFactory),
        sender: await getAccountAddress(accountOwner1.address, simpleAccountFactory)
      }, accountOwner1, entryPoint)
      await fund(op1.sender)
      await simulateValidation(op1, entryPoint.address, { gas: 10e6 }).catch(e => e)
      const block = await ethers.provider.getBlock('latest')
      const hash = block.transactions[0]
      await checkForBannedOps(hash, false)
    })
  })

  // describe('#simulateHandleOp', () => {
  //   it('should simulate execution', async () => {
  //     const accountOwner1 = createAccountOwner()
  //     const { proxy: account } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address)
  //     await fund(account)
  //     const counter = await new TestCounter__factory(ethersSigner).deploy()
  //
  //     const count = counter.interface.encodeFunctionData('count')
  //     const callData = account.interface.encodeFunctionData('execute', [counter.address, 0, count])
  //     // deliberately broken signature.. simulate should work with it too.
  //     const userOp = await fillAndSign({
  //       sender: account.address,
  //       callData
  //     }, accountOwner1, entryPoint)
  //
  //     const ret = await entryPoint.callStatic.simulateHandleOp(userOp,
  //       counter.address,
  //       counter.interface.encodeFunctionData('counters', [account.address])
  //     ).catch(e => e.errorArgs)
  //
  //     const [countResult] = counter.interface.decodeFunctionResult('counters', ret.targetResult)
  //     expect(countResult).to.eql(1)
  //     expect(ret.targetSuccess).to.be.true
  //
  //     // actual counter is zero
  //     expect(await counter.counters(account.address)).to.eql(0)
  //   })
  // })
})
