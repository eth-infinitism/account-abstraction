import { BigNumberish, ContractReceipt, ContractTransaction, Wallet, utils, BigNumber } from 'ethers'
import { Interface, parseEther } from 'ethers/lib/utils'
import { assert, expect } from 'chai'
import { ethers } from 'hardhat'

import {
  EntryPoint, EntryPoint__factory,
  SimpleAccount,
  SimpleAccountFactory,
  SimpleAccountFactory__factory,
  TestERC20,
  TestERC20__factory,
  TestOracle2,
  TestOracle2__factory,
  TestUniswap,
  TestUniswap__factory,
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

describe.only('TokenPaymaster', function () {
  const priceDenominator = 1e6
  const initialPriceToken = 100000000
  const initialPriceEther = 500000000
  const ethersSigner = ethers.provider.getSigner()
  const beneficiaryAddress = '0x'.padEnd(42, '1')
  const testInterface = new Interface(
    [
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
  let weth: TestERC20

  before(async function () {
    entryPoint = await deployEntryPoint()
    testUniswap = await new TestUniswap__factory(ethersSigner).deploy()
    factory = await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint.address)

    accountOwner = createAccountOwner()
    chainId = (await accountOwner.provider.getNetwork()).chainId
    const { proxy } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address, factory)
    account = proxy
    await fund(account)
    await checkForGeth()
    token = await new TestERC20__factory(ethersSigner).deploy(6)
    weth = await new TestERC20__factory(ethersSigner).deploy(18)
    nativeAssetOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceEther)
    tokenOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceToken)
    const owner = await ethersSigner.getAddress()
    const tokenPaymasterConfig: TokenPaymaster.TokenPaymasterConfigStruct = {
      maxTokenBalance: 100e18.toString(),
      minEntryPointBalance: 1e17.toString(),
      priceMarkup: 1_500_000 // +50%
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
  })

  it('should be able to sponsor the UserOp while charging correct amount of ERC-20 tokens', async () => {
    await token.transfer(account.address, await token.balanceOf(await ethersSigner.getAddress()))
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
    const expectedTokenPrice = initialPriceEther / initialPriceToken
    const addedPostOpCost = BigNumber.from(op.maxFeePerGas).mul(40000)
    // added 150% priceMarkup
    // note: as price is in ether-per-token, and we want more tokens, increasing it means dividing it by markup
    const expectedTokenPriceWithMarkup = BigNumber.from(expectedTokenPrice).mul(priceDenominator).mul(10).div(15)
    const expectedTokenCharge = actualGasCostPaymaster.add(addedPostOpCost).mul(priceDenominator).div(expectedTokenPriceWithMarkup)
    const postOpGasCost = actualGasCostEntryPoint.sub(actualGasCostPaymaster)
    assert.equal(actualTokenChargeEvents.toString(), actualTokenCharge.toString())
    assert.equal(actualTokenChargeEvents.toString(), expectedTokenCharge.toString())
    assert.equal(actualTokenPrice.div(priceDenominator).toNumber(), expectedTokenPrice)
    assert.closeTo(postOpGasCost.div(tx.effectiveGasPrice).toNumber(), 40000, 20000)
  })

  it('should update cached token price if the change is above configured percentage', async function () {
    const snapshot = await ethers.provider.send('evm_snapshot', [])
    await token.transfer(account.address, await token.balanceOf(await ethersSigner.getAddress()))
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

    const oldExpectedPrice = (initialPriceEther / initialPriceToken) * priceDenominator
    const newExpectedPrice = oldExpectedPrice * 2

    const actualTokenPrice = decodedLogs[4].args.actualTokenPrice
    assert.equal(actualTokenPrice.toString(), newExpectedPrice.toString())

    await expect(tx).to
      .emit(paymaster, 'TokenPriceUpdated')
      .withArgs(newExpectedPrice, oldExpectedPrice)

    await ethers.provider.send('evm_revert', [snapshot])
  })

  it('should use token price supplied by the client if it is better than cached', async function () {
    await token.transfer(account.address, await token.balanceOf(await ethersSigner.getAddress()))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal(currentCachedPrice.div(priceDenominator).toString(), '5')
    const overrideTokenPrice = BigNumber.from(0.271 * priceDenominator)
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

    assert.equal(preChargeTokenPrice.toString(), overrideTokenPrice.toString())
  })

  it('should use cached token price if the one supplied by the client if it is worse', async function () {
    await token.transfer(account.address, await token.balanceOf(await ethersSigner.getAddress()))
    await token.sudoApprove(account.address, paymaster.address, ethers.constants.MaxUint256)

    const currentCachedPrice = await paymaster.cachedPrice()
    assert.equal(currentCachedPrice.div(priceDenominator).toString(), '5')
    // note: higher number is lower token price
    const overrideTokenPrice = BigNumber.from(50 * priceDenominator)
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
  })

  it('should revert in the first postOp run if the pre-charge ended up lower than the final transaction cost')

  it('should swap tokens for ether if it falls below configured value and deposit it', async function () {

  })

  it('TBD: should reject transaction if cached price is way too old')
})

// describe('#handleOps - refund, max price', () => {
//   let calldata: string
//   let priceData: string
//   before(async () => {
//     calldata = await account.populateTransaction.execute(accountOwner.address, 0, '0x').then(tx => tx.data!)
//     const price = await paymaster.previousPrice()
//     priceData = hexConcat([paymaster.address, hexZeroPad(price.mul(95).div(100).toHexString(), 32)])
//     await token.sudoTransfer(account.address, await ethersSigner.getAddress())
//   })
// })
// describe('with price change', () => {
//   describe('#handleOps - refund, no price', () => {
//     let calldata: string
//     let priceData: string
//     before(async () => {
//       calldata = await account.populateTransaction.execute(accountOwner.address, 0, '0x').then(tx => tx.data!)
//       priceData = hexConcat([paymaster.address])
//       const priceOld = await paymaster.previousPrice()
//       await nativeAssetOracle.setPrice(priceOld.mul(103).div(100))
//       await token.sudoTransfer(account.address, await ethersSigner.getAddress())
//     })
//   })
//
//   describe('#handleOps - refund, max price', () => {
//     let calldata: string
//     let priceData: string
//     before(async () => {
//       calldata = await account.populateTransaction.execute(accountOwner.address, 0, '0x').then(tx => tx.data!)
//       const price = await paymaster.previousPrice()
//       priceData = hexConcat([paymaster.address, hexZeroPad(price.mul(95).div(100).toHexString(), 32)])
//       const priceOld = await paymaster.previousPrice()
//       await nativeAssetOracle.setPrice(priceOld.mul(103).div(100))
//       await token.sudoTransfer(account.address, await ethersSigner.getAddress())
//     })
//   })
// })
