import { BigNumberish, ContractReceipt, ContractTransaction, Wallet, utils, BigNumber } from 'ethers'
import { Interface, parseEther } from 'ethers/lib/utils'
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
} from '../../typechain'
import {
  OracleHelper as OracleHelperNamespace,
  UniswapHelper as UniswapHelperNamespace
} from '../../typechain/contracts/samples/TokenPaymaster'
import { checkForGeth, createAccount, createAccountOwner, deployEntryPoint, fund } from '../testutils'

import { fillUserOp, signUserOp } from '../UserOp'

function generatePaymasterAndData (pm: string, tokenPrice?: BigNumberish): string {
  if (tokenPrice != null) {
    return utils.hexlify(
      utils.concat([pm, utils.hexZeroPad(utils.hexlify(tokenPrice), 32)])
    )
  } else {
    return utils.hexlify(
      utils.concat([pm])
    )
  }
}

const priceDenominator = BigNumber.from(10).pow(26)

describe.only('TokenPaymaster', function () {
  const minEntryPointBalance = 1e17.toString()
  const initialPriceToken = 100000000 // USD per TOK
  const initialPriceEther = 500000000 // USD per ETH
  const ethersSigner = ethers.provider.getSigner()
  const beneficiaryAddress = '0x'.padEnd(42, '1')
  const testInterface = new Interface(
    [
      ...TestUniswap__factory.abi,
      ...TestERC20__factory.abi,
      ...TokenPaymaster__factory.abi,
      ...EntryPoint__factory.abi
    ]
  )

  let chainId: number
  let testUniswap: TestUniswap
  let entryPoint: EntryPoint
  let accountOwner: Wallet
  let tokenOracle: TestOracle2
  let nativeAssetOracle: TestOracle2
  let account: SimpleAccount
  let factory: SimpleAccountFactory
  let paymasterAddress: string
  let paymaster: TokenPaymaster
  let callData: string
  let token: TestERC20
  let weth: TestWrappedNativeToken

  before(async function () {
    entryPoint = await deployEntryPoint()
    weth = await new TestWrappedNativeToken__factory(ethersSigner).deploy()
    testUniswap = await new TestUniswap__factory(ethersSigner).deploy(weth.address)
    factory = await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint.address)

    accountOwner = createAccountOwner()
    chainId = (await accountOwner.provider.getNetwork()).chainId
    const { proxy } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address, factory)
    account = proxy
    await fund(account)
    await checkForGeth()
    token = await new TestERC20__factory(ethersSigner).deploy(6)
    nativeAssetOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceEther, 8)
    tokenOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceToken, 8)
    await weth.deposit({ value: parseEther('1') })
    await weth.transfer(testUniswap.address, parseEther('1'))
    const owner = await ethersSigner.getAddress()
    const tokenPaymasterConfig: TokenPaymaster.TokenPaymasterConfigStruct = {
      minEntryPointBalance,
      priceMarkup: priceDenominator.mul(15).div(10) // +50%
    }

    const oracleHelperConfig: OracleHelperNamespace.OracleHelperConfigStruct = {
      cacheTimeToLive: 10,
      nativeOracle: nativeAssetOracle.address,
      nativeOracleReverse: false,
      priceUpdateThreshold: 200_000, // +20%
      tokenOracle: tokenOracle.address,
      tokenOracleReverse: false,
      tokenToNativeOracle: false
    }

    const uniswapHelperConfig: UniswapHelperNamespace.UniswapHelperConfigStruct = {
      minSwapAmount: 1,
      slippage: 5,
      uniswapPoolFee: 3
    }

    paymaster = await new TokenPaymaster__factory(ethersSigner).deploy(
      token.address,
      entryPoint.address,
      weth.address,
      testUniswap.address,
      tokenPaymasterConfig,
      oracleHelperConfig,
      uniswapHelperConfig,
      owner
    )
    paymasterAddress = paymaster.address

    await token.transfer(paymaster.address, 100)
    await paymaster.updateCachedPrice(true)
    await entryPoint.depositTo(paymaster.address, { value: parseEther('1000') })
    await paymaster.addStake(1, { value: parseEther('2') })

    callData = await account.populateTransaction.execute(accountOwner.address, 0, '0x').then(tx => tx.data!)
  })

  it('paymaster should reject if account does not have enough tokens or allowance', async () => {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    const paymasterAndData = generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    await expect(
      entryPoint.handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
    ).to.be.revertedWith('AA33 reverted: ERC20: insufficient allowance')

    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    await expect(
      entryPoint.handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
    ).to.revertedWith('AA33 reverted: ERC20: transfer amount exceeds balance')
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should be able to sponsor the UserOp while charging correct amount of ERC-20 tokens', async () => {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const paymasterAndData = generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 3e7 })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })
    const preChargeTokens = decodedLogs[0].args.value
    const refundTokens = decodedLogs[2].args.value
    const actualTokenChargeEvents = preChargeTokens.sub(refundTokens)
    const actualTokenCharge = decodedLogs[3].args.actualTokenCharge
    const actualTokenPrice = decodedLogs[3].args.actualTokenPrice
    const actualGasCostPaymaster = decodedLogs[3].args.actualGasCost
    const actualGasCostEntryPoint = decodedLogs[4].args.actualGasCost
    const expectedTokenPrice = initialPriceToken / initialPriceEther // ether is 5x the token => ether-per-token is 0.2
    const addedPostOpCost = BigNumber.from(op.maxFeePerGas).mul(40000)

    // note: as price is in ether-per-token, and we want more tokens, increasing it means dividing it by markup
    const expectedTokenPriceWithMarkup = priceDenominator
      .mul(initialPriceToken).div(initialPriceEther) // expectedTokenPrice of 0.2 as BigNumber
      .mul(10).div(15) // added 150% priceMarkup
    const expectedTokenCharge = actualGasCostPaymaster.add(addedPostOpCost).mul(priceDenominator).div(expectedTokenPriceWithMarkup)
    const postOpGasCost = actualGasCostEntryPoint.sub(actualGasCostPaymaster)
    assert.equal(decodedLogs.length, 5)
    assert.equal(decodedLogs[4].args.success, true)
    assert.equal(actualTokenChargeEvents.toString(), actualTokenCharge.toString())
    assert.equal(actualTokenChargeEvents.toString(), expectedTokenCharge.toString())
    assert.equal(actualTokenPrice / (priceDenominator as any), expectedTokenPrice)
    assert.closeTo(postOpGasCost.div(tx.effectiveGasPrice).toNumber(), 40000, 20000)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should update cached token price if the change is above configured percentage', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)
    await tokenOracle.setPrice(initialPriceToken * 5)
    await nativeAssetOracle.setPrice(initialPriceEther * 10)

    const paymasterAndData = generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const tx: ContractTransaction = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
    const receipt: ContractReceipt = await tx.wait()

    const decodedLogs = receipt.logs.map(it => {
      return testInterface.parseLog(it)
    })

    const oldExpectedPrice = priceDenominator.mul(initialPriceToken).div(initialPriceEther)
    const newExpectedPrice = oldExpectedPrice.div(2) // ether DOUBLED in price relative to token

    const actualTokenPrice = decodedLogs[4].args.actualTokenPrice
    assert.equal(actualTokenPrice.toString(), newExpectedPrice.toString())

    await expect(tx).to
      .emit(paymaster, 'TokenPriceUpdated')
      .withArgs(newExpectedPrice, oldExpectedPrice)

    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should use token price supplied by the client if it is better than cached', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal((currentCachedPrice as any) / (priceDenominator as any), 0.2)
    const overrideTokenPrice = priceDenominator.mul(132).div(1000)
    const paymasterAndData = generatePaymasterAndData(paymasterAddress, overrideTokenPrice)

    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })

    const preChargeTokens = decodedLogs[0].args.value
    const requiredGas = BigNumber.from(op.callGasLimit).add(BigNumber.from(op.verificationGasLimit).mul(3)).add(op.preVerificationGas).add(40000 /*  REFUND_POSTOP_COST */)
    const requiredPrefund = requiredGas.mul(op.maxFeePerGas)
    const preChargeTokenPrice = requiredPrefund.mul(priceDenominator).div(preChargeTokens)

    // TODO: div 1e10 to hide rounding errors. look into it - 1e10 is too much.
    assert.equal(preChargeTokenPrice.div(1e10).toString(), overrideTokenPrice.div(1e10).toString())
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should use cached token price if the one supplied by the client if it is worse', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal((currentCachedPrice as any) / (priceDenominator as any), 0.2)
    // note: higher number is lower token price
    const overrideTokenPrice = priceDenominator.mul(50)
    const paymasterAndData = generatePaymasterAndData(paymasterAddress, overrideTokenPrice)
    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })

    const preChargeTokens = decodedLogs[0].args.value
    const requiredGas = BigNumber.from(op.callGasLimit).add(BigNumber.from(op.verificationGasLimit).mul(3)).add(op.preVerificationGas).add(40000 /*  REFUND_POSTOP_COST */)
    const requiredPrefund = requiredGas.mul(op.maxFeePerGas)
    const preChargeTokenPrice = requiredPrefund.mul(priceDenominator).div(preChargeTokens)

    assert.equal(preChargeTokenPrice.toString(), currentCachedPrice.mul(10).div(15).toString())
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should charge the overdraft tokens if the pre-charge ended up lower than the final transaction cost', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, await token.balanceOf(await ethersSigner.getAddress()))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    // Ether price increased 100 times!
    await tokenOracle.setPrice(initialPriceToken)
    await nativeAssetOracle.setPrice(initialPriceEther * 100)
    // Cannot happen too fast though
    await ethers.provider.send('evm_increaseTime', [200])

    const paymasterAndData = generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })

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
    await token.transfer(account.address, parseEther('0.01'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    // Ether price increased 100 times!
    await tokenOracle.setPrice(initialPriceToken)
    await nativeAssetOracle.setPrice(initialPriceEther * 100)
    // Cannot happen too fast though
    await ethers.provider.send('evm_increaseTime', [200])

    // Withdraw most of the tokens the account hs inside the inner transaction
    const withdrawTokensCall = await token.populateTransaction.transfer(token.address, parseEther('0.009')).then(tx => tx.data!)
    const callData = await account.populateTransaction.execute(token.address, 0, withdrawTokensCall).then(tx => tx.data!)

    const paymasterAndData = generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })
    const userOpSuccess = decodedLogs[2].args.success
    assert.equal(userOpSuccess, false)
    assert.equal(decodedLogs.length, 3)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should swap tokens for ether if it falls below configured value and deposit it', async function () {
    await token.transfer(account.address, await token.balanceOf(await ethersSigner.getAddress()))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const depositInfo = await entryPoint.deposits(paymaster.address)
    await paymaster.withdrawTo(account.address, depositInfo.deposit)

    // deposit exactly the minimum amount so the next UserOp makes it go under
    await entryPoint.depositTo(paymaster.address, { value: minEntryPointBalance })

    const paymasterAndData = generatePaymasterAndData(paymasterAddress)
    let op = await fillUserOp({
      sender: account.address,
      paymasterAndData,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const tx = await entryPoint
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())
    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })

    // note: it is hard to deploy Uniswap on hardhat - so stubbing it for the unit test
    assert.equal(decodedLogs[4].name, 'StubUniswapExchangeEvent')
    assert.equal(decodedLogs[8].name, 'Received')
    assert.equal(decodedLogs[9].name, 'Deposited')
    const deFactoExchangeRate = decodedLogs[4].args.amountOut.toString() / decodedLogs[4].args.amountIn.toString()
    const expectedPrice = initialPriceToken / initialPriceEther
    assert.closeTo(deFactoExchangeRate, expectedPrice, 0.001)
  })
})
