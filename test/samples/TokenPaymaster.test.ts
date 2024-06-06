import { ContractReceipt, ContractTransaction, Wallet, utils, BigNumber } from 'ethers'
import { hexlify, hexZeroPad, Interface, parseEther, parseUnits } from 'ethers/lib/utils'
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
import {
  checkForGeth,
  createAccount,
  createAccountOwner,
  decodeRevertReason,
  deployEntryPoint,
  fund, objdump
} from '../testutils'

import { fillUserOp, packUserOp, signUserOp } from '../UserOp'

const priceDenominator = BigNumber.from(10).pow(26)

function uniq (arr: any[]): any[] {
  // remove items with duplicate "name" attribute
  return Object.values(arr.reduce((set, item) => ({ ...set, [item.name]: item }), {}))
}

describe('TokenPaymaster', function () {
  const minEntryPointBalance = 1e17.toString()
  const initialPriceToken = 100000000 // USD per TOK
  const initialPriceEther = 500000000 // USD per ETH
  const ethersSigner = ethers.provider.getSigner()
  const beneficiaryAddress = '0x'.padEnd(42, '1')
  const testInterface = new Interface(
    uniq([
      ...TestUniswap__factory.abi,
      ...TestERC20__factory.abi,
      ...TokenPaymaster__factory.abi,
      ...EntryPoint__factory.abi
    ])
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
  let paymasterOwner: string
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
    paymasterOwner = await ethersSigner.getAddress()
    const tokenPaymasterConfig: TokenPaymaster.TokenPaymasterConfigStruct = {
      priceMaxAge: 86400,
      refundPostopCost: 40000,
      minEntryPointBalance,
      priceMarkup: priceDenominator.mul(15).div(10) // +50%
    }

    const oracleHelperConfig: OracleHelperNamespace.OracleHelperConfigStruct = {
      cacheTimeToLive: 0,
      maxOracleRoundAge: 0,
      nativeOracle: nativeAssetOracle.address,
      nativeOracleReverse: false,
      priceUpdateThreshold: priceDenominator.mul(12).div(100).toString(), // 20%
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
      paymasterOwner
    )
    paymasterAddress = paymaster.address

    await token.transfer(paymaster.address, 100)
    await paymaster.updateCachedPrice(true)
    await entryPoint.depositTo(paymaster.address, { value: parseEther('1000') })
    await paymaster.addStake(1, { value: parseEther('2') })

    callData = await account.populateTransaction.execute(accountOwner.address, 0, '0x').then(tx => tx.data!)
  })

  it('Only owner should withdraw eth from paymaster to destination', async function () {
    const recipient = accountOwner.address
    const amount = 2e18.toString()
    const balanceBefore = await ethers.provider.getBalance(paymasterAddress)
    await fund(paymasterAddress, '2')
    const balanceAfter = await ethers.provider.getBalance(paymasterAddress)
    assert.equal(balanceBefore.add(BigNumber.from(amount)).toString(), balanceAfter.toString())

    const impersonatedSigner = await ethers.getImpersonatedSigner('0x1234567890123456789012345678901234567890')
    const paymasterDifferentSigner = TokenPaymaster__factory.connect(paymasterAddress, impersonatedSigner)

    // should revert for non owner
    await expect(paymasterDifferentSigner.withdrawEth(paymasterOwner, amount)).to.be.revertedWith('OwnableUnauthorizedAccount')

    // should revert if the transfer fails
    await expect(paymaster.withdrawEth(recipient, BigNumber.from(amount).mul(2))).to.be.revertedWith('withdraw failed')

    const recipientBalanceBefore = await ethers.provider.getBalance(recipient)
    await paymaster.withdrawEth(recipient, balanceAfter)
    const recipientBalanceAfter = await ethers.provider.getBalance(recipient)
    assert.equal(recipientBalanceBefore.add(BigNumber.from(amount)).toString(), recipientBalanceAfter.toString())
  })

  it('paymaster should reject if postOpGaSLimit is too low', async () => {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    const config = await paymaster.tokenPaymasterConfig()
    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: config.refundPostopCost - 1, // too low
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)
    // await expect(
    expect(await entryPoint.handleOps([opPacked], beneficiaryAddress, { gasLimit: 1e7 })
      .catch(e => decodeRevertReason(e)))
      .to.match(/TPM: postOpGasLimit too low/)

    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('paymaster should reject if account does not have enough tokens or allowance', async () => {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)
    // await expect(
    expect(await entryPoint.handleOps([opPacked], beneficiaryAddress, { gasLimit: 1e7 })
      .catch(e => decodeRevertReason(e)))
      .to.match(/FailedOpWithRevert\(0,"AA33 reverted",ERC20InsufficientAllowance/)

    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    expect(await entryPoint.handleOps([opPacked], beneficiaryAddress, { gasLimit: 1e7 })
      .catch(e => decodeRevertReason(e)))
      .to.match(/FailedOpWithRevert\(0,"AA33 reverted",ERC20InsufficientBalance/)

    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should be able to sponsor the UserOp while charging correct amount of ERC-20 tokens', async () => {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)
    // for simpler 'gasPrice()' calculation
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', [utils.hexlify(op.maxFeePerGas)])
    const tx = await entryPoint
      .handleOps([opPacked], beneficiaryAddress, {
        gasLimit: 3e7,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxFeePerGas
      }
      )
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })
    const preChargeTokens = decodedLogs[0].args.value
    const refundTokens = decodedLogs[2].args.value
    const actualTokenChargeEvents = preChargeTokens.sub(refundTokens)
    const actualTokenCharge = decodedLogs[3].args.actualTokenCharge
    const actualTokenPriceWithMarkup = decodedLogs[3].args.actualTokenPriceWithMarkup
    const actualGasCostPaymaster = decodedLogs[3].args.actualGasCost
    const actualGasCostEntryPoint = decodedLogs[4].args.actualGasCost
    const addedPostOpCost = BigNumber.from(op.maxFeePerGas).mul(40000)

    // note: as price is in ether-per-token, and we want more tokens, increasing it means dividing it by markup
    const expectedTokenPriceWithMarkup = priceDenominator
      .mul(initialPriceToken).div(initialPriceEther) // expectedTokenPrice of 0.2 as BigNumber
      .mul(10).div(15) // added 150% priceMarkup
    const expectedTokenCharge = actualGasCostPaymaster.add(addedPostOpCost).mul(priceDenominator).div(expectedTokenPriceWithMarkup).div(BigNumber.from(10).pow(18 - 6)) // token decimals is 6
    const postOpGasCost = actualGasCostEntryPoint.sub(actualGasCostPaymaster)
    assert.equal(decodedLogs.length, 5)
    assert.equal(decodedLogs[4].args.success, true)
    assert.equal(actualTokenChargeEvents.toString(), actualTokenCharge.toString())
    assert.equal(actualTokenChargeEvents.toString(), expectedTokenCharge.toString())
    assert.equal(actualTokenPriceWithMarkup.toString(), expectedTokenPriceWithMarkup.toString())
    assert.closeTo(postOpGasCost.div(tx.effectiveGasPrice).toNumber(), 50000, 20000)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should update cached token price if the change is above configured percentage', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)
    await tokenOracle.setPrice(initialPriceToken * 5)
    await nativeAssetOracle.setPrice(initialPriceEther * 10)

    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)
    const tx: ContractTransaction = await entryPoint
      .handleOps([opPacked], beneficiaryAddress, { gasLimit: 1e7 })
    const receipt: ContractReceipt = await tx.wait()
    const block = await ethers.provider.getBlock(receipt.blockHash)

    const decodedLogs = receipt.logs.map(it => {
      return testInterface.parseLog(it)
    })

    const oldExpectedPrice = priceDenominator.mul(initialPriceToken).div(initialPriceEther)
    const newExpectedPrice = oldExpectedPrice.div(2) // ether DOUBLED in price relative to token
    const oldExpectedPriceWithMarkup = oldExpectedPrice.mul(10).div(15)
    const newExpectedPriceWithMarkup = oldExpectedPriceWithMarkup.div(2)

    const actualTokenPriceWithMarkup = decodedLogs[4].args.actualTokenPriceWithMarkup
    assert.equal(actualTokenPriceWithMarkup.toString(), newExpectedPriceWithMarkup.toString())
    await expect(tx).to
      .emit(paymaster, 'TokenPriceUpdated')
      .withArgs(newExpectedPrice, oldExpectedPrice, block.timestamp)

    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should use token price supplied by the client if it is better than cached', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal((currentCachedPrice as any) / (priceDenominator as any), 0.2)
    const overrideTokenPrice = priceDenominator.mul(132).div(1000)

    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      paymasterData: hexZeroPad(hexlify(overrideTokenPrice), 32),
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)

    // for simpler 'gasPrice()' calculation
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', [utils.hexlify(op.maxFeePerGas)])
    const tx = await entryPoint
      .handleOps([opPacked], beneficiaryAddress, {
        gasLimit: 1e7,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxFeePerGas
      })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })

    const preChargeTokens = decodedLogs[0].args.value
    const requiredGas = BigNumber.from(op.callGasLimit).add(BigNumber.from(op.verificationGasLimit).add(BigNumber.from(op.paymasterVerificationGasLimit))).add(BigNumber.from(op.paymasterPostOpGasLimit)).add(op.preVerificationGas).add(40000 /*  REFUND_POSTOP_COST */)
    const requiredPrefund = requiredGas.mul(op.maxFeePerGas)
    const preChargeTokenPrice = requiredPrefund.mul(priceDenominator).div(preChargeTokens).div(BigNumber.from(10).pow(18 - 6)) // token decimals is 6

    // assert we didn't charge more than user allowed
    assert.isTrue(overrideTokenPrice.lte(preChargeTokenPrice))

    // assert the token amount is the most optimal that can be charged, which means if charging more token the price will be lower than the one supplied by the client
    const tokenPriceIfCharingMore = requiredPrefund.mul(priceDenominator).div(preChargeTokens.add(1)).div(BigNumber.from(10).pow(18 - 6)) // token decimals is 6
    assert.isTrue(tokenPriceIfCharingMore.lte(overrideTokenPrice))
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should use cached token price if the one supplied by the client is worse', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, parseEther('1'))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal((currentCachedPrice as any) / (priceDenominator as any), 0.2)
    // note: higher number is lower token price
    const overrideTokenPrice = priceDenominator.mul(50)
    let op = await fillUserOp({
      sender: account.address,
      maxFeePerGas: 1000000000,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      paymasterData: hexZeroPad(hexlify(overrideTokenPrice), 32),
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)

    // for simpler 'gasPrice()' calculation
    await ethers.provider.send('hardhat_setNextBlockBaseFeePerGas', [utils.hexlify(op.maxFeePerGas)])
    const tx = await entryPoint
      .handleOps([opPacked], beneficiaryAddress, {
        gasLimit: 1e7,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxFeePerGas
      })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })

    const preChargeTokens = decodedLogs[0].args.value
    const requiredGas = BigNumber.from(op.callGasLimit).add(BigNumber.from(op.verificationGasLimit).add(BigNumber.from(op.paymasterVerificationGasLimit))).add(BigNumber.from(op.paymasterPostOpGasLimit)).add(op.preVerificationGas).add(40000 /*  REFUND_POSTOP_COST */)
    const requiredPrefund = requiredGas.mul(op.maxFeePerGas)
    const preChargeTokenPrice = requiredPrefund.mul(priceDenominator).div(preChargeTokens).div(BigNumber.from(10).pow(18 - 6)) // token decimals is 6
    const expectedPrice = currentCachedPrice.mul(10).div(15)

    // assert we didn't charge more than the amount calculated by the cached price
    assert.isTrue(expectedPrice.lte(preChargeTokenPrice))

    // assert the token amount is the most optimal that can be charged, which means if charging more token the price will be lower than the oracle price
    const tokenPriceIfCharingMore = requiredPrefund.mul(priceDenominator).div(preChargeTokens.add(1)).div(BigNumber.from(10).pow(18 - 6)) // token decimals is 6
    assert.isTrue(tokenPriceIfCharingMore.lte(expectedPrice))

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

    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)
    const tx = await entryPoint
      .handleOps([opPacked], beneficiaryAddress, { gasLimit: 1e7 })
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
    await token.transfer(account.address, parseUnits('0.01', 6))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    // Ether price increased 100 times!
    await tokenOracle.setPrice(initialPriceToken)
    await nativeAssetOracle.setPrice(initialPriceEther * 100)
    // Cannot happen too fast though
    await ethers.provider.send('evm_increaseTime', [200])

    // Withdraw most of the tokens the account hs inside the inner transaction
    const withdrawTokensCall = await token.populateTransaction.transfer(token.address, parseUnits('0.009', 6)).then(tx => tx.data!)
    const callData = await account.populateTransaction.execute(token.address, 0, withdrawTokensCall).then(tx => tx.data!)

    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)
    const tx = await entryPoint
      .handleOps([opPacked], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())

    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })
    console.log(decodedLogs.map((e: any) => ({ ev: e.name, ...objdump(e.args!) })))

    const postOpRevertReason = decodeRevertReason(decodedLogs[2].args.revertReason)
    assert.include(postOpRevertReason, 'PostOpReverted(ERC20InsufficientBalance')
    const userOpSuccess = decodedLogs[3].args.success
    assert.equal(userOpSuccess, false)
    assert.equal(decodedLogs.length, 4)
    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should swap tokens for ether if it falls below configured value and deposit it', async function () {
    await token.transfer(account.address, await token.balanceOf(await ethersSigner.getAddress()))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const depositInfo = await entryPoint.deposits(paymaster.address)
    await paymaster.withdrawTo(account.address, depositInfo.deposit)

    // deposit exactly the minimum amount so the next UserOp makes it go under
    await entryPoint.depositTo(paymaster.address, { value: minEntryPointBalance })

    let op = await fillUserOp({
      sender: account.address,
      paymaster: paymasterAddress,
      paymasterVerificationGasLimit: 3e5,
      paymasterPostOpGasLimit: 3e5,
      callData
    }, entryPoint)
    op = signUserOp(op, accountOwner, entryPoint.address, chainId)
    const opPacked = packUserOp(op)
    const tx = await entryPoint
      .handleOps([opPacked], beneficiaryAddress, { gasLimit: 1e7 })
      .then(async tx => await tx.wait())
    const decodedLogs = tx.logs.map(it => {
      return testInterface.parseLog(it)
    })

    // note: it is hard to deploy Uniswap on hardhat - so stubbing it for the unit test
    assert.equal(decodedLogs[4].name, 'StubUniswapExchangeEvent')
    assert.equal(decodedLogs[8].name, 'Received')
    assert.equal(decodedLogs[9].name, 'Deposited')
    const deFactoExchangeRate = decodedLogs[4].args.amountOut.toString() / decodedLogs[4].args.amountIn.toString() / 1e12
    const expectedPrice = initialPriceToken / initialPriceEther
    assert.closeTo(deFactoExchangeRate, expectedPrice, 0.001)
  })
})
