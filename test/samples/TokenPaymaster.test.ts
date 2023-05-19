import { BigNumberish, ContractReceipt, ContractTransaction, providers, Signer, utils, Wallet } from 'ethers'
import { TransactionRequest } from '@ethersproject/abstract-provider'
import { ethers } from 'hardhat'
import { assert, expect } from 'chai'
import { Interface, parseEther } from 'ethers/lib/utils'

import {
  EntryPoint, EntryPoint__factory,
  SimpleAccount,
  SimpleAccountFactory,
  SimpleAccountFactory__factory,
  TestERC20,
  TestERC20__factory,
  TestOracle2,
  TestOracle2__factory,
  TokenPaymaster,
  TokenPaymaster__factory
} from '../../typechain'
import { checkForGeth, createAccount, createAccountOwner, deployEntryPoint, fund } from '../testutils'

import { fillUserOp, signUserOp } from '../UserOp'

export interface ERC20PaymasterBuildOptions {
  entrypoint: string
  nativeAssetOracle: string
  tokenAddress: string
  tokenOracle: string
  owner: string
  deployer: Signer
}

const CREATE_2_FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C'
const SALT = '0x0000000000000000000000000000000000000000000000000000000000000000'

function generatePaymasterAndData (pm: string, tokenAmount?: BigNumberish): string {
  if (tokenAmount != null) {
    return utils.hexlify(
      utils.concat([pm, utils.hexZeroPad(utils.hexlify(tokenAmount), 32)])
    )
  } else {
    return utils.hexlify(
      utils.concat([pm])
    )
  }
}

export function getPaymasterConstructor (
  options: ERC20PaymasterBuildOptions
): string {
  const constructorArgs = [
    options.tokenAddress,
    options.entrypoint,
    options.tokenOracle,
    options.nativeAssetOracle,
    options.owner
  ]
  const paymasterConstructor = new Interface(TokenPaymaster__factory.abi).encodeDeploy(constructorArgs)
  return utils.hexlify(utils.concat([TokenPaymaster__factory.bytecode, paymasterConstructor]))
}

export async function deployERC20Paymaster (
  provider: providers.Provider,
  options: ERC20PaymasterBuildOptions
): Promise<string> {
  const constructorBytecode = getPaymasterConstructor(options)

  const tx: TransactionRequest = {
    to: CREATE_2_FACTORY,
    data: utils.hexConcat([
      SALT,
      constructorBytecode
    ])
  }
  const txResponse = await options.deployer.sendTransaction(tx)
  const receipt = await txResponse.wait()
  if (receipt.status === 0) {
    throw new Error(`ERC20Paymaster deployment failed: ${receipt.transactionHash}`)
  }
  return utils.getCreate2Address(
    CREATE_2_FACTORY,
    SALT,
    utils.keccak256(constructorBytecode)
  )
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

  before(async function () {
    entryPoint = await deployEntryPoint()
    factory = await new SimpleAccountFactory__factory(ethersSigner).deploy(entryPoint.address)

    accountOwner = createAccountOwner()
    chainId = (await accountOwner.provider.getNetwork()).chainId
    const { proxy } = await createAccount(ethersSigner, await accountOwner.getAddress(), entryPoint.address, factory)
    account = proxy
    await fund(account)
    await checkForGeth()
    token = await new TestERC20__factory(ethersSigner).deploy(6)
    nativeAssetOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceEther)
    tokenOracle = await new TestOracle2__factory(ethersSigner).deploy(initialPriceToken)
    const owner = await ethersSigner.getAddress()
    paymasterAddress = await deployERC20Paymaster(accountOwner.provider, {
      entrypoint: entryPoint.address,
      tokenAddress: token.address,
      tokenOracle: tokenOracle.address,
      nativeAssetOracle: nativeAssetOracle.address,
      owner: owner,
      deployer: ethersSigner
    })
    paymaster = TokenPaymaster__factory.connect(paymasterAddress, ethersSigner)

    await token.transfer(paymaster.address, 100)
    await paymaster.updatePrice(true)
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
      .handleOps([op], beneficiaryAddress, { gasLimit: 1e7 })
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
    const addedPostOpCost = tx.effectiveGasPrice.mul(40000)
    const expectedTokenCharge = actualGasCostPaymaster.add(addedPostOpCost).mul(expectedTokenPrice).mul(11).div(10) // added 110% priceMarkup
    const postOpGasCost = actualGasCostEntryPoint.sub(actualGasCostPaymaster)
    assert.equal(actualTokenChargeEvents.toString(), actualTokenCharge.toString())
    assert.equal(actualTokenChargeEvents.toString(), expectedTokenCharge.toString())
    assert.equal(actualTokenPrice.div(priceDenominator).toNumber(), expectedTokenPrice)
    assert.closeTo(postOpGasCost.div(tx.effectiveGasPrice).toNumber(), 40000, 20000)
  })

  it('should update cached token price if the change is above configured percentage', async function () {
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

    const actualTokenPrice = decodedLogs[3].args.actualTokenPrice
    assert.equal(actualTokenPrice.toString(), newExpectedPrice.toString())

    await expect(tx).to
      .emit(paymaster, 'TokenPriceUpdated')
      .withArgs(newExpectedPrice, oldExpectedPrice)
  })

  it('should use token price supplied by the client if it is higher than cached')
  it('should revert in the first postOp run if the pre-charge ended up lower than the final transaction cost')

  it('should swap tokens for ether if it falls below configured value and deposit it', async function () {

  })
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
