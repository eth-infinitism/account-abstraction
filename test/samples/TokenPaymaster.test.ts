import {
  BigNumberish,
  Wallet,
  getBigInt,
  Signer,
  Interface,
  parseEther,
  concat,
  hexlify,
  toBeHex,
  MaxUint256,
  AddressLike,
  resolveAddress,
  LogDescription,
  toNumber,
  ContractTransactionReceipt, Block
} from 'ethers'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'

import {
  EntryPoint,
  EntryPoint__factory,
  SimpleAccount,
  SimpleAccountFactory,
  SimpleAccountFactory__factory,
  TestERC20,
  TestERC20__factory,
  TestOracle2,
  TestOracle2__factory,
  TestUniswap,
  TestUniswap__factory,
  TestWrappedNativeToken,
  TestWrappedNativeToken__factory,
  TokenPaymaster,
  TokenPaymaster__factory
} from '../../src/types'
import {
  OracleHelper as OracleHelperNamespace,
  UniswapHelper as UniswapHelperNamespace
} from '../../src/types/contracts/samples/TokenPaymaster'
import { checkForGeth, createAccount, createAccountOwner, deployEntryPoint, fund } from '../testutils'

import { fillUserOp, signUserOp } from '../UserOp'
import { TransactionReceiptParams } from 'ethers/lib.commonjs/providers/formatting'

async function generatePaymasterAndData (pmAddr: AddressLike, tokenPrice?: BigNumberish): Promise<string> {
  const pm = await resolveAddress(pmAddr)
  if (tokenPrice != null) {
    return hexlify(
      concat([pm, toBeHex(tokenPrice, 32)])
    )
  } else {
    return concat([pm])
  }
}

const priceDenominator = getBigInt(10) ** 26n

describe('TokenPaymaster', function () {
  const minEntryPointBalance = 1e17.toString()
  const initialPriceToken = 100000000n // USD per TOK
  const initialPriceEther = 500000000n // USD per ETH
  let ethersSigner: Signer
  const beneficiaryAddress = '0x'.padEnd(42, '1')
  const testInterface = new Interface(
    [
      ...TestUniswap__factory.abi,
      ...TestERC20__factory.abi,
      ...TokenPaymaster__factory.abi,
      ...EntryPoint__factory.abi
    ]
  )

  let chainId: bigint
  let testUniswap: TestUniswap
  let entryPoint: EntryPoint
  let accountOwner: Wallet
  let tokenOracle: TestOracle2
  let nativeAssetOracle: TestOracle2
  let account: SimpleAccount
  let factory: SimpleAccountFactory
  let paymasterAddress: AddressLike
  let paymaster: TokenPaymaster
  let callData: string
  let token: TestERC20
  let weth: TestWrappedNativeToken

  before(async function () {
    ethersSigner = await ethers.provider.getSigner()
    entryPoint = await deployEntryPoint()
    weth = await new TestWrappedNativeToken__factory(ethersSigner).deploy()
    testUniswap = await new TestUniswap__factory(ethersSigner).deploy(weth.target)
    factory = await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint.target)

    accountOwner = createAccountOwner()
    chainId = (await ethers.provider.getNetwork()).chainId
    const { proxy } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.target, factory)
    account = proxy
    await fund(account)
    await checkForGeth()
    token = await new TestERC20__factory(ethersSigner).deploy(6)
    nativeAssetOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceEther, 8)
    tokenOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceToken, 8)
    await weth.deposit({ value: parseEther('1') })
    await weth.transfer(testUniswap.target, parseEther('1'))
    const owner = await ethersSigner.getAddress()
    const tokenPaymasterConfig: TokenPaymaster.TokenPaymasterConfigStruct = {
      priceMaxAge: 86400,
      refundPostopCost: 40000,
      minEntryPointBalance,
      priceMarkup: priceDenominator * 15n / 10n // +50%
    }

    const oracleHelperConfig: OracleHelperNamespace.OracleHelperConfigStruct = {
      cacheTimeToLive: 0,
      nativeOracle: nativeAssetOracle.target,
      nativeOracleReverse: false,
      priceUpdateThreshold: 200_000, // +20%
      tokenOracle: tokenOracle.target,
      tokenOracleReverse: false,
      tokenToNativeOracle: false
    }

    const uniswapHelperConfig: UniswapHelperNamespace.UniswapHelperConfigStruct = {
      minSwapAmount: 1,
      slippage: 5,
      uniswapPoolFee: 3
    }

    paymaster = await new TokenPaymaster__factory(ethersSigner).deploy(
      token.target,
      entryPoint.target,
      weth.target,
      testUniswap.target,
      tokenPaymasterConfig,
      oracleHelperConfig,
      uniswapHelperConfig,
      owner
    )
    paymasterAddress = paymaster.target

    await token.transfer(paymaster.target, 100)
    await paymaster.updateCachedPrice(true)
    await entryPoint.depositTo(paymaster.target, { value: parseEther('1000') })
    await paymaster.addStake(1, { value: parseEther('2') })

    callData = await account.execute.populateTransaction(accountOwner.address, 0, '0x').then(tx => tx.data!)
  })

  it('paymaster should reject if account does not have enough tokens or allowance', async () => {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    const paymasterAndData = await generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)
    await expect(
      entryPoint.handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
    ).to.be.revertedWith('AA33 reverted: ERC20: insufficient allowance')

    await token.sudoApprove(account.target, paymaster.target, MaxUint256)

    await expect(
      entryPoint.handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
    ).to.revertedWith('AA33 reverted: ERC20: transfer amount exceeds balance')
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should be able to sponsor the UserOp while charging correct amount of ERC-20 tokens', async () => {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.target, parseEther('1'))
    await token.sudoApprove(account.target, paymaster.target, MaxUint256)

    const paymasterAndData = await generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)
    // for simpler 'gasPrice()' calculation
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', [toBeHex(op.maxFeePerGas)])
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, {
        gasLimit: 3e7,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxFeePerGas
      }
      )
      .then(async tx => (await tx.wait())!)

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it as any)
    }) as LogDescription[]
    const preChargeTokens = decodedLogs[0].args.value
    const refundTokens = decodedLogs[2].args.value
    const actualTokenChargeEvents = preChargeTokens.sub(refundTokens)
    const actualTokenCharge = getBigInt(decodedLogs[3].args.actualTokenCharge)
    const actualTokenPrice = getBigInt(decodedLogs[3].args.actualTokenPrice)
    const actualGasCostPaymaster = getBigInt(decodedLogs[3].args.actualGasCost)
    const actualGasCostEntryPoint = getBigInt(decodedLogs[4].args.actualGasCost)
    const expectedTokenPrice = initialPriceToken / initialPriceEther // ether is 5x the token => ether-per-token is 0.2
    const addedPostOpCost = getBigInt(op.maxFeePerGas) * 40000n

    // note: as price is in ether-per-token, and we want more tokens, increasing it means dividing it by markup
    const expectedTokenPriceWithMarkup = priceDenominator *
      initialPriceToken / initialPriceEther * // expectedTokenPrice of 0.2 as BigNumber
      10n / 15n // added 150% priceMarkup
    const expectedTokenCharge = (actualGasCostPaymaster + addedPostOpCost) * priceDenominator / expectedTokenPriceWithMarkup
    const postOpGasCost = actualGasCostEntryPoint - actualGasCostPaymaster
    assert.equal(decodedLogs.length, 5)
    assert.equal(decodedLogs[4].args.success, true)
    assert.equal(actualTokenChargeEvents.toString(), actualTokenCharge.toString())
    assert.equal(actualTokenChargeEvents.toString(), expectedTokenCharge.toString())
    assert.equal(actualTokenPrice / (priceDenominator as any), expectedTokenPrice)

    const effectiveGasPrice = (tx as TransactionReceiptParams).effectiveGasPrice
    assert.closeTo(toNumber(postOpGasCost / effectiveGasPrice!), 40000, 20000)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should update cached token price if the change is above configured percentage', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.target, parseEther('1'))
    await token.sudoApprove(account.target, paymaster.target, MaxUint256)
    await tokenOracle.setPrice(initialPriceToken * 5n)
    await nativeAssetOracle.setPrice(initialPriceEther * 10n)

    const paymasterAndData = await generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
    const receipt = await tx.wait() as ContractTransactionReceipt
    const block = await ethers.provider.getBlock(receipt.blockHash) as Block

    const decodedLogs = receipt.logs.map(it => {
      return testInterface.parseLog(it as any)
    }) as LogDescription[]

    const oldExpectedPrice = priceDenominator * initialPriceToken / initialPriceEther
    const newExpectedPrice = oldExpectedPrice / 2n // ether DOUBLED in price relative to token

    const actualTokenPrice = decodedLogs[4].args.actualTokenPrice
    assert.equal(actualTokenPrice.toString(), newExpectedPrice.toString())

    await expect(tx).to
      .emit(paymaster, 'TokenPriceUpdated')
      .withArgs(newExpectedPrice, oldExpectedPrice, block.timestamp)

    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should use token price supplied by the client if it is better than cached', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.target, parseEther('1'))
    await token.sudoApprove(account.target, paymaster.target, MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal((currentCachedPrice as any) / (priceDenominator as any), 0.2)
    const overrideTokenPrice = priceDenominator * 132n / 1000n
    const paymasterAndData = await generatePaymasterAndData(paymasterAddress, overrideTokenPrice)

    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)

    // for simpler 'gasPrice()' calculation
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', [toBeHex(op.maxFeePerGas)])
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, {
        gasLimit: 1e7,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxFeePerGas
      })
      .then(async tx => (await tx.wait())!)

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it as any)
    }) as LogDescription[]

    const preChargeTokens = decodedLogs[0].args.value
    const requiredGas = (getBigInt(op.callGasLimit) + getBigInt(op.verificationGasLimit)) * 3n + getBigInt(op.preVerificationGas) + 40000n /* REFUND_POSTOP_COST */

    const requiredPrefund = requiredGas * getBigInt(op.maxFeePerGas)
    const preChargeTokenPrice = requiredPrefund * priceDenominator / preChargeTokens

    // TODO: div 1e10 to hide rounding errors. look into it - 1e10 is too much.
    const rounding = 1000000n
    assert.equal(preChargeTokenPrice / rounding, overrideTokenPrice / rounding)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should use cached token price if the one supplied by the client if it is worse', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.target, parseEther('1'))
    await token.sudoApprove(account.target, paymaster.target, MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal((currentCachedPrice as any) / (priceDenominator as any), 0.2)
    // note: higher number is lower token price
    const overrideTokenPrice = priceDenominator * 50n
    const paymasterAndData = await generatePaymasterAndData(paymasterAddress, overrideTokenPrice)
    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)

    // for simpler 'gasPrice()' calculation
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', [toBeHex(op.maxFeePerGas)])
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, {
        gasLimit: 1e7,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxFeePerGas
      })
      .then(async tx => (await tx.wait())!)

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it as any)
    }) as LogDescription[]

    const preChargeTokens = decodedLogs[0].args.value
    const requiredGas = (getBigInt(op.callGasLimit) + getBigInt(op.verificationGasLimit) * 3n + getBigInt(op.preVerificationGas) + 40000n /*  REFUND_POSTOP_COST */)
    const requiredPrefund = requiredGas * getBigInt(op.maxFeePerGas)
    const preChargeTokenPrice = requiredPrefund * priceDenominator / preChargeTokens

    assert.equal(preChargeTokenPrice, currentCachedPrice * 10n / 15n)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should charge the overdraft tokens if the pre-charge ended up lower than the final transaction cost', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.target, await token.balanceOf(await ethersSigner.getAddress()))
    await token.sudoApprove(account.target, paymaster.target, MaxUint256)

    // Ether price increased 100 times!
    await tokenOracle.setPrice(initialPriceToken)
    await nativeAssetOracle.setPrice(initialPriceEther * 100n)
    // Cannot happen too fast though
    await ethers.provider.send('evm_increaseTime', [200])

    const paymasterAndData = await generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => (await tx.wait())!)

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it as any)
    }) as LogDescription[]

    const preChargeTokens = decodedLogs[0].args.value
    const overdraftTokens = decodedLogs[3].args.value
    const actualTokenCharge = decodedLogs[4].args.actualTokenCharge
    // Checking that both 'Transfers' are from account to Paymaster
    assert.equal(decodedLogs[0].args.from, decodedLogs[3].args.from)
    assert.equal(decodedLogs[0].args.to, decodedLogs[3].args.to)

    assert.equal(preChargeTokens.add(overdraftTokens).toString(), actualTokenCharge.toString())

    const userOpSuccess = decodedLogs[5].args.success
    assert.equal(userOpSuccess, true)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should revert in the first postOp run if the pre-charge ended up lower than the final transaction cost but the client has no tokens to cover the overdraft', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])

    // Make sure account has small amount of tokens
    await token.transfer(account.target, parseEther('0.01'))
    await token.sudoApprove(account.target, paymaster.target, MaxUint256)

    // Ether price increased 100 times!
    await tokenOracle.setPrice(initialPriceToken)
    await nativeAssetOracle.setPrice(initialPriceEther * 100n)
    // Cannot happen too fast though
    await ethers.provider.send('evm_increaseTime', [200])

    // Withdraw most of the tokens the account hs inside the inner transaction
    const withdrawTokensCall = await token.transfer.populateTransaction(token.target, parseEther('0.009')).then(tx => tx.data!)
    const callData = await account.execute.populateTransaction(token.target, 0, withdrawTokensCall).then(tx => tx.data!)

    const paymasterAndData = await generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())

    const decodedLogs = tx!.logs.map(it => {
      return testInterface.parseLog(it as any)
    })
    const userOpSuccess = decodedLogs[3]?.args.success
    assert.equal(userOpSuccess, false)
    assert.equal(decodedLogs.length, 4)
    assert.equal(decodedLogs[2]?.name, 'PostOpReverted')
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should swap tokens for ether if it falls below configured value and deposit it', async function () {
    await token.transfer(account.target, await token.balanceOf(await ethersSigner.getAddress()))
    await token.sudoApprove(account.target, paymaster.target, MaxUint256)

    const depositInfo = await entryPoint.deposits(paymaster.target)
    await paymaster.withdrawTo(account.target, depositInfo.deposit)

    // deposit exactly the minimum amount so the next UserOp makes it go under
    await entryPoint.depositTo(paymaster.target, { value: minEntryPointBalance })

    const paymasterAndData = await generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.target,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.target, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())
    const decodedLogs = tx?.logs.map(it => {
      return testInterface.parseLog(it as any)
    }) as any

    // note: it is hard to deploy Uniswap on hardhat - so stubbing it for the unit test
    assert.equal(decodedLogs[4].name, 'StubUniswapExchangeEvent')
    assert.equal(decodedLogs[8].name, 'Received')
    assert.equal(decodedLogs[9].name, 'Deposited')
    const deFactoExchangeRate = decodedLogs[4].args.amountOut.toString() / decodedLogs[4].args.amountIn.toString()
    const expectedPrice = initialPriceToken / initialPriceEther
    assert.closeTo(deFactoExchangeRate, toNumber(expectedPrice), 0.001)
  })
})
