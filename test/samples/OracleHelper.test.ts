import { assert } from 'chai'
import { ethers } from 'hardhat'

import { AddressZero } from '../testutils'

import {
  TestERC20,
  TestERC20__factory,
  TestOracle2,
  TestOracle2__factory,
  TokenPaymaster,
  TokenPaymaster__factory
} from '../../typechain'
import {
  OracleHelper as OracleHelperNamespace,
  UniswapHelper as UniswapHelperNamespace
} from '../../typechain/contracts/samples/TokenPaymaster'
import { BigNumber } from 'ethers'
import { parseEther } from 'ethers/lib/utils'

const priceDenominator = BigNumber.from(10).pow(26)

const sampleResponses = {
  'LINK/USD': {
    decimals: 8,
    answer: '633170000', // Answer: $6.3090 - note: price is USD per LINK
    roundId: '110680464442257310968',
    startedAt: '1684929731',
    updatedAt: '1684929731',
    answeredInRound: '110680464442257310968'
  },
  'ETH/USD': {
    decimals: 8,
    answer: '181451000000', // Answer: $1,817.65 - USD per ETH
    roundId: '110680464442257311466',
    startedAt: '1684929347',
    updatedAt: '1684929347',
    answeredInRound: '110680464442257311466'
  },
  'LINK/ETH': { // the direct route may be better in some use-cases
    decimals: 18,
    answer: '3492901256673149', // Answer: Ξ0.0034929013 - the answer is exact ETH.WEI per LINK
    roundId: '73786976294838213626',
    startedAt: '1684924307',
    updatedAt: '1684924307',
    answeredInRound: '73786976294838213626'
  },
  'ETH/BTC': { // considering BTC to be a token to test a reverse price feed logic with real data
    decimals: 8,
    answer: '6810994', // ₿0.06810994
    roundId: '18446744073709566497',
    startedAt: '1684943615',
    updatedAt: '1684943615',
    answeredInRound: '18446744073709566497'
  }
}

// note: direct or reverse designations are quite arbitrary
describe('OracleHelper', function () {
  function testOracleFiguredPriceOut (): void {
    it('should figure out the correct price', async function () {
      await testEnv.paymaster.updateCachedPrice(true)
      const cachedPrice = await testEnv.paymaster.cachedPrice()
      const tokensPerEtherCalculated = await testEnv.paymaster.weiToToken(parseEther('1'), cachedPrice)
      assert.equal(cachedPrice.toString(), testEnv.expectedPrice.toString(), 'price not right')
      assert.equal(tokensPerEtherCalculated.toString(), testEnv.expectedTokensPerEtherCalculated.toString(), 'tokens amount not right')
    })
  }

  function getOracleConfig ({
    nativeOracleReverse,
    tokenOracleReverse,
    tokenToNativeOracle
  }: {
    nativeOracleReverse: boolean
    tokenOracleReverse: boolean
    tokenToNativeOracle: boolean
  }): OracleHelperNamespace.OracleHelperConfigStruct {
    return {
      nativeOracleReverse,
      tokenOracleReverse,
      tokenToNativeOracle,
      nativeOracle: testEnv.nativeAssetOracle.address,
      tokenOracle: testEnv.tokenOracle.address,
      cacheTimeToLive: 0,
      priceUpdateThreshold: 0
    }
  }

  interface TestEnv {
    owner: string
    expectedPrice: string
    expectedTokensPerEtherCalculated: string
    tokenPaymasterConfig: TokenPaymaster.TokenPaymasterConfigStruct
    uniswapHelperConfig: UniswapHelperNamespace.UniswapHelperConfigStruct
    token: TestERC20
    paymaster: TokenPaymaster
    tokenOracle: TestOracle2
    nativeAssetOracle: TestOracle2
  }

  // @ts-ignore
  const testEnv: TestEnv = {}

  before(async function () {
    const ethersSigner = ethers.provider.getSigner()
    testEnv.owner = await ethersSigner.getAddress()

    testEnv.tokenPaymasterConfig = {
      priceMaxAge: 86400,
      refundPostopCost: 40000,
      minEntryPointBalance: 0,
      priceMarkup: priceDenominator.mul(19).div(10) // 190%
    }
    testEnv.uniswapHelperConfig = {
      minSwapAmount: 1,
      slippage: 5,
      uniswapPoolFee: 3
    }

    // TODO: what do I need to do with the oracle decimals?
    testEnv.tokenOracle = await new TestOracle2__factory(ethersSigner).deploy(1, 0)
    testEnv.nativeAssetOracle = await new TestOracle2__factory(ethersSigner).deploy(1, 0)

    testEnv.token = await new TestERC20__factory(ethersSigner).deploy(18)

    testEnv.paymaster = await new TokenPaymaster__factory(ethersSigner).deploy(
      testEnv.token.address,
      AddressZero,
      AddressZero,
      testEnv.owner, // cannot approve to AddressZero
      testEnv.tokenPaymasterConfig,
      getOracleConfig({
        nativeOracleReverse: false,
        tokenOracleReverse: false,
        tokenToNativeOracle: false
      }),
      testEnv.uniswapHelperConfig,
      testEnv.owner
    )
  })

  describe('with one-hop direct price ETH per TOKEN', function () {
    before(async function () {
      const res = sampleResponses['LINK/ETH'] // note: Chainlink Oracle names are opposite direction of 'answer'
      await testEnv.tokenOracle.setPrice(res.answer) // Ξ0.0034929013
      await testEnv.tokenOracle.setDecimals(res.decimals)
      // making sure the native asset oracle is not accessed during the calculation
      await testEnv.nativeAssetOracle.setPrice('0xfffffffffffffffffffff')
      const tokenOracleDecimalPower = BigNumber.from(10).pow(res.decimals)
      testEnv.expectedPrice =
        BigNumber.from(res.answer)
          .mul(priceDenominator)
          .div(tokenOracleDecimalPower)
          .toString()

      testEnv.expectedTokensPerEtherCalculated =
        BigNumber
          .from(parseEther('1'))
          .mul(tokenOracleDecimalPower)
          .div(res.answer)
          .toString()

      const ethersSigner = ethers.provider.getSigner()
      testEnv.paymaster = await new TokenPaymaster__factory(ethersSigner).deploy(
        testEnv.token.address,
        AddressZero,
        AddressZero,
        testEnv.owner, // cannot approve to AddressZero
        testEnv.tokenPaymasterConfig,
        getOracleConfig({
          tokenToNativeOracle: true,
          tokenOracleReverse: false,
          nativeOracleReverse: false
        }),
        testEnv.uniswapHelperConfig,
        testEnv.owner
      )
    })

    testOracleFiguredPriceOut()
  })

  describe('with one-hop reverse price TOKEN per ETH', function () {
    before(async function () {
      const res = sampleResponses['ETH/BTC']
      await testEnv.tokenOracle.setPrice(res.answer) // ₿0.06810994
      await testEnv.tokenOracle.setDecimals(res.decimals)
      // making sure the native asset oracle is not accessed during the calculation
      await testEnv.nativeAssetOracle.setPrice('0xfffffffffffffffffffff')
      const tokenOracleDecimalPower = BigNumber.from(10).pow(res.decimals)
      testEnv.expectedPrice =
        BigNumber.from(priceDenominator)
          .mul(tokenOracleDecimalPower)
          .div(res.answer)
          .toString()

      const expectedTokensPerEtherCalculated =
        BigNumber
          .from(parseEther('1'))
          .mul(res.answer)
          .div(tokenOracleDecimalPower)
          .toString()

      testEnv.expectedTokensPerEtherCalculated =
        BigNumber
          .from(parseEther('1'))
          .mul(priceDenominator.toString())
          .div(testEnv.expectedPrice)
          .toString()

      // sanity check for the price calculation - use direct price and cached-like reverse price
      assert.equal(expectedTokensPerEtherCalculated.toString(), testEnv.expectedTokensPerEtherCalculated.toString())

      const ethersSigner = ethers.provider.getSigner()
      testEnv.paymaster = await new TokenPaymaster__factory(ethersSigner).deploy(
        testEnv.token.address,
        AddressZero,
        AddressZero,
        testEnv.owner, // cannot approve to AddressZero
        testEnv.tokenPaymasterConfig,
        getOracleConfig({
          tokenToNativeOracle: true,
          tokenOracleReverse: true,
          nativeOracleReverse: false
        }),
        testEnv.uniswapHelperConfig,
        testEnv.owner
      )
    })
    testOracleFiguredPriceOut()
  })

  describe('with two-hops price USD-per-TOKEN and USD-per-ETH', function () {
    before(async function () {
      const resToken = sampleResponses['LINK/USD']
      const resNative = sampleResponses['ETH/USD']

      await testEnv.tokenOracle.setPrice(resToken.answer) // $6.3090
      await testEnv.tokenOracle.setDecimals(resToken.decimals)

      await testEnv.nativeAssetOracle.setPrice(resNative.answer) // $1,817.65
      await testEnv.nativeAssetOracle.setDecimals(resNative.decimals)

      const ethersSigner = ethers.provider.getSigner()
      testEnv.paymaster = await new TokenPaymaster__factory(ethersSigner).deploy(
        testEnv.token.address,
        AddressZero,
        AddressZero,
        testEnv.owner, // cannot approve to AddressZero
        testEnv.tokenPaymasterConfig,
        getOracleConfig({
          tokenToNativeOracle: false,
          tokenOracleReverse: false,
          nativeOracleReverse: false
        }),
        testEnv.uniswapHelperConfig,
        testEnv.owner
      )
      // note: oracle decimals are same and cancel each other out
      testEnv.expectedPrice =
        priceDenominator
          .mul(resToken.answer)
          .div(resNative.answer)
          .toString()

      testEnv.expectedTokensPerEtherCalculated =
        BigNumber
          .from(parseEther('1'))
          .mul(priceDenominator.toString())
          .div(testEnv.expectedPrice)
          .toString()
    })

    testOracleFiguredPriceOut()
  })

  // TODO: these oracle types are not common but we probably want to support in any case
  describe.skip('with two-hops price TOK/USD and ETH/USD', () => {})
  describe.skip('with two-hops price TOK/USD and USD/ETH', () => {})
  describe.skip('with two-hops price USD/TOK and ETH/USD', () => {})
})
