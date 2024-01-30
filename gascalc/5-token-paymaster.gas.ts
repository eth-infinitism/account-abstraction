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
import { createAccountOwner } from '../test/testutils'
// const ethersSigner = ethers.provider.getSigner()

context('Token Paymaster', function () {
  this.timeout(60000)
  const g = new GasChecker()

  let paymasterAddress: string
  before(async () => {
    await GasCheckCollector.init()
    const globalSigner = ethers.provider.getSigner()
    const create2Factory = new Create2Factory(ethers.provider, globalSigner)

    const ethersSigner = createAccountOwner()
    await globalSigner.sendTransaction({ to: ethersSigner.getAddress(), value: parseEther('10') })

    const minEntryPointBalance = 1e17.toString()
    const initialPriceToken = 100000000 // USD per TOK
    const initialPriceEther = 500000000 // USD per ETH
    const priceDenominator = BigNumber.from(10).pow(26)

    const tokenInit = await new TestERC20__factory(ethersSigner).getDeployTransaction(6)
    const tokenAddress = await create2Factory.deploy(tokenInit, 0)
    const token = TestERC20__factory.connect(tokenAddress, ethersSigner)

    const wethInit = await new TestWrappedNativeToken__factory(ethersSigner).getDeployTransaction()
    const wethAddress = await create2Factory.deploy(wethInit, 0)
    const testUniswapInit = await new TestUniswap__factory(ethersSigner).getDeployTransaction(wethAddress)
    const testUniswapAddress = await create2Factory.deploy(testUniswapInit, 0)

    const tokenPaymasterConfig: TokenPaymaster.TokenPaymasterConfigStruct = {
      priceMaxAge: 86400,
      refundPostopCost: 40000,
      minEntryPointBalance,
      priceMarkup: priceDenominator.mul(15).div(10) // +50%
    }

    const nativeAssetOracleInit = await new TestOracle2__factory(ethersSigner).getDeployTransaction(initialPriceEther, 8)
    const nativeAssetOracleAddress = await create2Factory.deploy(nativeAssetOracleInit, 0, 10_000_000)
    const tokenOracleInit = await new TestOracle2__factory(ethersSigner).getDeployTransaction(initialPriceToken, 8)
    const tokenOracleAddress = await create2Factory.deploy(tokenOracleInit, 0, 10_000_000)

    const oracleHelperConfig: OracleHelperNamespace.OracleHelperConfigStruct = {
      cacheTimeToLive: 100000000,
      maxOracleRoundAge: 0,
      nativeOracle: nativeAssetOracleAddress,
      nativeOracleReverse: false,
      priceUpdateThreshold: priceDenominator.mul(2).div(10), // +20%
      tokenOracle: tokenOracleAddress,
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
      tokenAddress,
      g.entryPoint().address,
      wethAddress,
      testUniswapAddress,
      tokenPaymasterConfig,
      oracleHelperConfig,
      uniswapHelperConfig,
      owner
    ).data!)
    paymasterAddress = await create2Factory.deploy(paymasterInit, 0)
    const paymaster = TokenPaymaster__factory.connect(paymasterAddress, ethersSigner)
    await paymaster.addStake(1, { value: 1 })
    await g.entryPoint().depositTo(paymaster.address, { value: parseEther('10') })
    await paymaster.updateCachedPrice(true)
    await g.createAccounts1(11)
    await token.sudoMint(await ethersSigner.getAddress(), parseEther('20'))
    await token.transfer(paymaster.address, parseEther('0.1'))
    for (const address of g.createdAccounts) {
      await token.transfer(address, parseEther('1'))
      await token.sudoApprove(address, paymaster.address, ethers.constants.MaxUint256)
    }

    console.log('==addresses:', {
      ethersSigner: await ethersSigner.getAddress(),
      paymasterAddress,
      nativeAssetOracleAddress,
      tokenOracleAddress,
      tokenAddress,
      owner,
      createdAccounts: g.createdAccounts
    })
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
