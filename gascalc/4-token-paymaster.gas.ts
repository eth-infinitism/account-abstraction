import { parseEther } from 'ethers/lib/utils'
import {
  TestERC20__factory, TestOracle2__factory,
  TestUniswap__factory,
  TestWrappedNativeToken__factory, TokenPaymaster,
  TokenPaymaster__factory
} from '../typechain'
import { ethers } from 'hardhat'
import { GasCheckCollector, GasChecker } from './GasChecker'
import { Create2Factory } from '../src/Create2Factory'
import { hexValue } from '@ethersproject/bytes'
import {
  OracleHelper as OracleHelperNamespace,
  UniswapHelper as UniswapHelperNamespace
} from '../typechain/contracts/samples/TokenPaymaster'
import { BigNumber } from 'ethers'

const ethersSigner = ethers.provider.getSigner()

context('Token Paymaster', function () {
  this.timeout(60000)
  const g = new GasChecker()

  let paymasterAddress: string
  before(async () => {
    await GasCheckCollector.init()

    const minEntryPointBalance = 1e17.toString()
    const initialPriceToken = 100000000 // USD per TOK
    const initialPriceEther = 500000000 // USD per ETH
    const priceDenominator = BigNumber.from(10).pow(26)

    const token = await new TestERC20__factory(ethersSigner).deploy(6)

    const weth = await new TestWrappedNativeToken__factory(ethersSigner).deploy()
    const testUniswap = await new TestUniswap__factory(ethersSigner).deploy(weth.address)

    const tokenPaymasterConfig: TokenPaymaster.TokenPaymasterConfigStruct = {
      priceMaxAge: 86400,
      refundPostopCost: 40000,
      minEntryPointBalance,
      priceMarkup: priceDenominator.mul(15).div(10) // +50%
    }

    const nativeAssetOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceEther, 8)
    const tokenOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceToken, 8)

    const oracleHelperConfig: OracleHelperNamespace.OracleHelperConfigStruct = {
      cacheTimeToLive: 0,
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

    const owner = await ethersSigner.getAddress()

    const paymasterInit = hexValue(new TokenPaymaster__factory(ethersSigner).getDeployTransaction(
      token.address,
      g.entryPoint().address,
      weth.address,
      testUniswap.address,
      tokenPaymasterConfig,
      oracleHelperConfig,
      uniswapHelperConfig,
      owner
    ).data!)
    paymasterAddress = await new Create2Factory(ethers.provider, ethersSigner).deploy(paymasterInit, 0)
    const paymaster = TokenPaymaster__factory.connect(paymasterAddress, ethersSigner)
    await paymaster.addStake(1, { value: 1 })
    await g.entryPoint().depositTo(paymaster.address, { value: parseEther('10') })
    await paymaster.updateCachedPrice(true)
    await g.createAccounts1(11)
    for (const address of g.createdAccounts) {
      await token.transfer(address, parseEther('1'))
      await token.sudoApprove(address, paymaster.address, ethers.constants.MaxUint256)
    }
  })

  it('token paymaster', async function () {
    await g.addTestRow({ title: 'token paymaster', count: 1, paymaster: paymasterAddress, diffLastGas: false })
    await g.addTestRow({
      title: 'token paymaster with diff',
      count: 2,
      paymaster: paymasterAddress,
      diffLastGas: true
    })
  })

  it('token paymaster 10', async function () {
    if (g.skipLong()) this.skip()

    await g.addTestRow({ title: 'token paymaster', count: 10, paymaster: paymasterAddress, diffLastGas: false })
    await g.addTestRow({
      title: 'token paymaster with diff',
      count: 11,
      paymaster: paymasterAddress,
      diffLastGas: true
    })
  })
})
